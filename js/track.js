/* track.js — 實時巴士追蹤：路線軌跡 + 巴士位置推算
 *
 * 資料來源：運輸署 KMB route-eta API
 *   - API 對「每一站」回傳接下來 1–3 班車的預計到站時間（eta_seq 是「該站」的班次序，非固定車輛身份）
 *   - 已駛過的站不會有 ETA（null 或省略）
 *
 * 定位原理（重點）：
 *   1. 取每站的「最小 ETA」（下班車幾時到）→ m[seq]
 *   2. 沿站序掃描，當 m 出現「下跌」（例如第7站 35 分鐘、第8站 2 分鐘）
 *      → 代表有一班巴士剛過了第7站、正前往第8站 → 該處放一個巴士標記
 *   3. 標記位置 = 該段起站 S 減去剩餘時間佔比（剩 0 分鐘 = 正在 S 站；剩半程 = S 與 S-1 之間）
 *   4. 起點總站若有多班排隊（多個 ETA），額外放置等待中的標記
 *
 * 限制：API 只提供「預測到站時間」，非車輛 GPS；位置為推算值。
 */
(function() {
  'use strict';

  var API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb/route-eta/';
  var REFRESH_MS = 10000;
  var COLLAPSE_THRESHOLD = 30;
  var COLLAPSE_SPAN = 3;
  var STALE_MS = 60000;            // 超過 1 分鐘的過期 ETA 視為失效
  var QUEUE_GAP_MS = 5 * 60000;    // 總站排隊班次最小間隔
  var MAX_MARKERS = 6;

  var allRoutes = [];
  var currentRoute = null;
  var currentBound = 'O';
  var nodes = [];
  var seqList = [];
  var rowH = 56;
  var etaMap = {};       // seq -> [ts, ts, ts]（升冪）
  var markers = [];      // [{ pos, remain, queued, label }]
  var myStop = null;
  var userLoc = null;
  var stopsMinPromise = null;
  var refreshTimer = null;
  var rafId = null;
  var isFetching = false;
  var showAll = false;

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var elLoading = document.getElementById('track-loading');
  var elMissing = document.getElementById('track-missing');
  var elApp = document.getElementById('track-app');
  var elRouteNum = document.getElementById('track-route-number');
  var elCompany = document.getElementById('track-company-badge');
  var elRouteDir = document.getElementById('track-route-dir');
  var elDirToggle = document.getElementById('track-direction-toggle');
  var elHeroNum = document.getElementById('track-hero-num');
  var elHeroLabel = document.getElementById('track-hero-label');
  var elHeroSub = document.getElementById('track-hero-sub');
  var elHeroProgress = document.getElementById('track-hero-progress');
  var elLocateBtn = document.getElementById('track-locate-btn');
  var elRail = document.getElementById('track-rail');
  var elBuses = document.getElementById('track-buses');
  var elProgressLine = document.getElementById('track-progress-line');
  var elCollapseBtn = document.getElementById('track-collapse-btn');

  if (!elApp) return;

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function t(key, vars) {
    return (window.LANG && LANG.t) ? LANG.t(key, vars) : key;
  }

  function computeRowH() {
    return window.innerWidth >= 640 ? 64 : 56;
  }

  /* ---------- data ---------- */

  function buildNodes(stops) {
    var map = {};
    var order = [];
    (stops || []).forEach(function(s) {
      var seq = parseInt(s.seq, 10);
      if (isNaN(seq)) return;
      if (!map[seq]) {
        map[seq] = { seq: seq, names: [], stopIds: [] };
        order.push(seq);
      }
      var nm = s.name_tc || '';
      if (nm && map[seq].names.indexOf(nm) === -1) map[seq].names.push(nm);
      if (s.stop_id && map[seq].stopIds.indexOf(s.stop_id) === -1) map[seq].stopIds.push(s.stop_id);
    });
    order.sort(function(a, b) { return a - b; });
    return order.map(function(k) { return map[k]; });
  }

  /* 每站收集所有班次的 ETA（升冪） */
  function buildEtaMap(rows) {
    var out = {};
    (rows || []).forEach(function(e) {
      if (e.dir !== currentBound || !e.eta) return;
      var seq = parseInt(e.seq, 10);
      var ts = Date.parse(e.eta);
      if (isNaN(seq) || isNaN(ts)) return;
      (out[seq] = out[seq] || []).push(ts);
    });
    Object.keys(out).forEach(function(k) {
      out[k].sort(function(a, b) { return a - b; });
      // 去掉重複（同站同分）
      out[k] = out[k].filter(function(v, i, arr) { return i === 0 || v - arr[i - 1] > 30000; });
      out[k] = out[k].slice(0, 3);
    });
    return out;
  }

  /* 核心：由「每站最小 ETA」曲線找出巴士位置
   *  - ETA 出現明顯下跌 = 有一班巴士剛過站、正前往下一站
   *  - 下跌門檻採自適應（2 倍中位數行車時間，最少 2 分鐘），避免小波動誤判
   */
  function buildMarkers(now) {
    var m = {};
    var seqs = [];
    seqList.forEach(function(s) {
      var arr = etaMap[s] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] > now - STALE_MS) { m[s] = arr[i]; seqs.push(s); break; }
      }
    });
    if (!seqs.length) return [];

    // 全域中位數行車時間
    var alldiffs = [];
    for (var i = 1; i < seqs.length; i++) {
      var dd = m[seqs[i]] - m[seqs[i - 1]];
      if (dd > 0) alldiffs.push(dd);
    }
    alldiffs.sort(function(a, b) { return a - b; });
    var medTravel = alldiffs.length ? alldiffs[Math.floor(alldiffs.length / 2)] : 150000;
    if (medTravel <= 0) medTravel = 150000;
    var dropThreshold = Math.max(2 * medTravel, 2 * 60000);

    // 1) 依 ETA 下跌切段；每段開頭 = 一班巴士
    var segStarts = [seqs[0]];
    for (var j = 1; j < seqs.length; j++) {
      if (m[seqs[j]] < m[seqs[j - 1]] - dropThreshold) segStarts.push(seqs[j]);
    }

    var out = [];
    for (var k = 0; k < segStarts.length; k++) {
      var S = segStarts[k];
      var endSeq = (k + 1 < segStarts.length) ? segStarts[k + 1] : (seqs[seqs.length - 1] + 1);
      var diffs = [];
      for (var q = 1; q < seqs.length; q++) {
        var sq = seqs[q];
        var prevSq = seqs[q - 1];
        if (sq < S || sq >= endSeq) continue;
        if (prevSq >= S && m[sq] > m[prevSq]) diffs.push(m[sq] - m[prevSq]);
      }
      diffs.sort(function(a, b) { return a - b; });
      var travel = diffs.length ? diffs[Math.floor(diffs.length / 2)] : medTravel;
      if (travel <= 0) travel = medTravel;

      var remain = m[S] - now;
      var frac = remain / travel;
      if (frac < 0) frac = 0;
      if (frac > 1) frac = 1;
      var pos = S - frac;
      if (pos < seqList[0]) pos = seqList[0];
      if (pos > seqList[seqList.length - 1]) pos = seqList[seqList.length - 1];
      out.push({ pos: pos, remain: remain, queued: frac >= 1 });
    }

    // 2) 總站排隊的額外班次（同一總站有多個未過期 ETA）
    var firstSeq = seqList[0];
    var termEtas = (etaMap[firstSeq] || []).filter(function(x) { return x > now - STALE_MS; });
    var atTerminus = 0;
    out.forEach(function(x) { if (x.pos <= firstSeq + 0.01) atTerminus++; });
    for (var z = atTerminus; z < termEtas.length && out.length < MAX_MARKERS; z++) {
      var gap = z > 0 ? termEtas[z] - termEtas[z - 1] : Infinity;
      if (gap >= QUEUE_GAP_MS) {
        out.push({ pos: firstSeq, remain: termEtas[z] - now, queued: true });
      }
    }

    // 3) 由前到後排序，前三班給標籤
    out.sort(function(a, b) { return b.pos - a.pos; });
    out = out.slice(0, MAX_MARKERS);
    for (var n = 0; n < out.length; n++) {
      out[n].tier = n + 1;
      out[n].label = n === 0 ? t('track_next_bus')
        : (n === 1 ? t('track_second_bus')
        : (n === 2 ? t('track_third_bus') : ''));
    }
    return out;
  }

  function yOf(p) {
    if (!seqList.length) return 0;
    var i = 0;
    while (i < seqList.length - 1 && p >= seqList[i + 1]) i++;
    var a = seqList[i];
    var b = (i + 1 < seqList.length) ? seqList[i + 1] : a + 1;
    var frac = b > a ? (p - a) / (b - a) : 0;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return (i + frac) * rowH;
  }

  function indexOfSeq(seq) {
    for (var i = 0; i < seqList.length; i++) {
      if (seqList[i] === seq) return i;
    }
    return -1;
  }

  /* ---------- render ---------- */

  function renderRail() {
    var html = '';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var cls = 'track-row';
      if (i === 0) cls += ' is-first';
      if (i === nodes.length - 1) cls += ' is-last';
      html += '<div class="' + cls + '" data-i="' + i + '" data-seq="' + n.seq + '" style="height:' + rowH + 'px">' +
        '<span class="track-node" aria-hidden="true"></span>' +
        '<span class="track-seq">' + n.seq + '</span>' +
        '<span class="track-name">' + esc(n.names.join(' ／ ')) + '</span>' +
        '<span class="track-eta" data-eta-seq="' + n.seq + '"></span>' +
      '</div>';
    }
    var old = elRail.querySelectorAll('.track-row');
    for (var k = 0; k < old.length; k++) old[k].parentNode.removeChild(old[k]);
    elRail.insertAdjacentHTML('afterbegin', html);
    elRail.style.height = (nodes.length * rowH) + 'px';
    markMyStop();
    applyCollapse();
  }

  function markMyStop() {
    var rows = elRail.querySelectorAll('.track-row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-mine');
    if (!myStop || myStop.route !== currentRoute) return;
    var idx = indexOfSeq(parseInt(myStop.seq, 10));
    if (idx < 0) return;
    if (rows[idx]) rows[idx].classList.add('is-mine');
  }

  function applyCollapse() {
    var rows = elRail.querySelectorAll('.track-row');
    if (!rows.length) return;
    if (showAll || nodes.length <= COLLAPSE_THRESHOLD) {
      for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-hidden');
      updateCollapseBtn();
      return;
    }
    var front = markers.length ? markers[0].pos : seqList[0];
    var busIdx = indexOfSeq(Math.floor(front));
    if (busIdx < 0) busIdx = 0;
    var myIdx = (myStop && myStop.route === currentRoute) ? indexOfSeq(parseInt(myStop.seq, 10)) : -1;
    var lo = Math.max(0, busIdx - COLLAPSE_SPAN);
    var hi = myIdx >= 0 ? Math.min(rows.length - 1, myIdx + COLLAPSE_SPAN) : Math.min(rows.length - 1, busIdx + 8);
    if (hi < lo) hi = lo;
    for (var j = 0; j < rows.length; j++) {
      var keep = (j === 0 || j === rows.length - 1 || (j >= lo && j <= hi));
      if (keep) rows[j].classList.remove('is-hidden');
      else rows[j].classList.add('is-hidden');
    }
    updateCollapseBtn();
  }

  function updateCollapseBtn() {
    if (!elCollapseBtn) return;
    if (nodes.length <= COLLAPSE_THRESHOLD) {
      elCollapseBtn.hidden = true;
      return;
    }
    elCollapseBtn.hidden = false;
    elCollapseBtn.textContent = showAll ? t('track_show_nearby') : t('track_show_all', { n: nodes.length });
  }

  function renderMarkerEls() {
    var html = '';
    for (var i = 0; i < markers.length; i++) {
      var mk = markers[i];
      var tier = Math.min(mk.tier || (i + 1), 3);
      html += '<div class="track-bus tier-' + tier + '" data-idx="' + i + '" style="top:0">' +
        '<span class="track-bus-icon">🚌</span>' +
        (mk.label ? '<span class="track-bus-tag">' + esc(mk.label) + '</span>' : '') +
      '</div>';
    }
    elBuses.innerHTML = html;
  }

  function paintMarkers(now) {
    markers = buildMarkers(now);
    // 若標記數量變動，重建 DOM
    if (elBuses.children.length !== markers.length) renderMarkerEls();

    var lastPos = null;
    var offset = 0;
    for (var i = 0; i < markers.length; i++) {
      var mk = markers[i];
      var el = elBuses.querySelector('.track-bus[data-idx="' + i + '"]');
      if (!el) continue;
      var tag = el.querySelector('.track-bus-tag');
      if (tag) {
        if (mk.label && tag.textContent !== mk.label) tag.textContent = mk.label;
      } else if (mk.label) {
        el.insertAdjacentHTML('beforeend', '<span class="track-bus-tag">' + esc(mk.label) + '</span>');
      }
      // 重疊錯開
      if (lastPos !== null && Math.abs(mk.pos - lastPos) < 0.5) offset += 15;
      else offset = 0;
      lastPos = mk.pos;

      var y = yOf(mk.pos) + rowH / 2 - 16 + offset;
      el.style.transform = 'translate3d(0,' + y + 'px,0)';
      el.title = mk.label;
      if (mk.queued) el.classList.add('is-waiting');
      else el.classList.remove('is-waiting');
      mk.offset = offset;
    }

    if (elProgressLine) {
      var front = markers.length ? markers[0].pos : seqList[0];
      elProgressLine.style.height = Math.max(0, yOf(front) + rowH / 2) + 'px';
    }
    updateHero(now);
  }

  function renderStopEtas() {
    var cells = elRail.querySelectorAll('.track-eta');
    var now = Date.now();
    for (var i = 0; i < cells.length; i++) {
      var seq = parseInt(cells[i].getAttribute('data-eta-seq'), 10);
      var list = etaMap[seq] || [];
      var txt = '';
      for (var k = 0; k < list.length && k < 3; k++) {
        var mins = Math.round((list[k] - now) / 60000);
        if (mins < 0) continue;
        var cls = mins <= 0 ? 'red' : (mins <= 3 ? 'amber' : 'green');
        txt += '<span class="track-eta-val ' + cls + '">' + (mins <= 0 ? t('eta_lt_min') : mins + ' ' + t('eta_min')) + '</span>';
      }
      cells[i].innerHTML = txt || '<span class="track-eta-val gray">--</span>';
    }
  }

  function updateHero(now) {
    var mySeq = (myStop && myStop.route === currentRoute) ? parseInt(myStop.seq, 10) : null;

    if (mySeq !== null && etaMap[mySeq] && etaMap[mySeq].length) {
      var next = null;
      for (var i = 0; i < etaMap[mySeq].length; i++) {
        if (etaMap[mySeq][i] > now) { next = etaMap[mySeq][i]; break; }
      }
      if (next === null) next = etaMap[mySeq][etaMap[mySeq].length - 1];
      var mins = Math.round((next - now) / 60000);
      if (mins <= 0) {
        elHeroNum.textContent = t('track_soon');
        elHeroLabel.textContent = '';
      } else {
        elHeroNum.textContent = mins;
        elHeroLabel.textContent = t('eta_min');
      }
      elHeroSub.textContent = (myStop.name || '') + ' · ' + t('track_my_stop');
    } else if (mySeq !== null) {
      elHeroNum.textContent = '--';
      elHeroLabel.textContent = t('track_no_eta');
      elHeroSub.textContent = (myStop.name || '') + ' · ' + t('track_my_stop');
    } else {
      elHeroNum.textContent = markers.length ? markers.length : '--';
      elHeroLabel.textContent = markers.length ? t('track_current') : t('track_no_eta');
      elHeroSub.textContent = t('track_tap_hint');
    }

    if (elHeroProgress) {
      var front = markers.length ? markers[0].pos : seqList[0];
      var lastSeq = seqList[seqList.length - 1] || 1;
      elHeroProgress.style.width = Math.max(0, Math.min(100, (front / lastSeq) * 100)) + '%';
    }
  }

  function stopAnimation() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function animate() {
    paintMarkers(Date.now());
    rafId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    stopAnimation();
    if (reducedMotion) { paintMarkers(Date.now()); return; }
    rafId = requestAnimationFrame(animate);
  }

  /* ---------- fetch ---------- */

  function fetchEta() {
    if (isFetching || !currentRoute) return;
    isFetching = true;
    fetch(API_BASE + encodeURIComponent(currentRoute) + '/1')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        etaMap = buildEtaMap((d && d.data) || []);
        renderMarkerEls();
        renderStopEtas();
        paintMarkers(Date.now());
        applyCollapse();
        startAnimation();
      })
      .catch(function() {
        if (!Object.keys(etaMap).length) {
          elHeroNum.textContent = '--';
          elHeroLabel.textContent = t('track_no_eta');
        }
      })
      .then(function() { isFetching = false; });
  }

  /* ---------- geo ---------- */

  function loadStopsMin() {
    if (!stopsMinPromise) {
      stopsMinPromise = fetch('data/bus-stops-min.json')
        .then(function(r) { return r.json(); })
        .catch(function() { return {}; });
    }
    return stopsMinPromise;
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestNode(lat, lng, stops) {
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var sid = nodes[i].stopIds[0];
      if (!sid || !stops[sid]) continue;
      var la = parseFloat(stops[sid][1]);
      var ln = parseFloat(stops[sid][2]);
      if (isNaN(la) || isNaN(ln)) continue;
      var d = haversineM(lat, lng, la, ln);
      if (!best || d < best.dist) {
        best = { idx: i, seq: nodes[i].seq, dist: d, stopId: sid, name: nodes[i].names.join(' ／ ') };
      }
    }
    return best;
  }

  function setMyStopByNode(node) {
    myStop = {
      route: currentRoute,
      bound: currentBound,
      seq: node.seq,
      stop_id: node.stopId,
      name: node.name
    };
    try { localStorage.setItem('bus_my_stop', JSON.stringify(myStop)); } catch (e) {}
    markMyStop();
    applyCollapse();
    updateHero(Date.now());
  }

  function doLocate() {
    if (!navigator.geolocation) {
      if (elHeroSub) elHeroSub.textContent = t('track_loc_denied');
      return;
    }
    var original = elLocateBtn ? elLocateBtn.innerHTML : '';
    if (elLocateBtn) { elLocateBtn.disabled = true; elLocateBtn.textContent = t('track_locating'); }
    navigator.geolocation.getCurrentPosition(function(pos) {
      userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      loadStopsMin().then(function(stops) {
        var best = nearestNode(userLoc.lat, userLoc.lng, stops);
        if (elLocateBtn) { elLocateBtn.disabled = false; elLocateBtn.innerHTML = original; }
        if (!best) return;
        if (best.dist <= 800) {
          setMyStopByNode(best);
          if (best.dist > 300 && elHeroSub) {
            elHeroSub.textContent = (best.name || '') + ' · ' + t('track_gps_accuracy', { n: Math.round(best.dist) });
          }
        } else if (elHeroSub) {
          elHeroSub.textContent = t('track_not_on_route', { n: Math.round(best.dist) });
        }
      });
    }, function() {
      if (elLocateBtn) { elLocateBtn.disabled = false; elLocateBtn.innerHTML = original; }
      if (elHeroSub) elHeroSub.textContent = t('track_loc_denied');
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  }

  /* ---------- init ---------- */

  function restoreMyStop() {
    try {
      var saved = JSON.parse(localStorage.getItem('bus_my_stop') || 'null');
      if (saved && saved.route === currentRoute) myStop = saved;
    } catch (e) {}
  }

  function renderRouteHeader() {
    var r0 = allRoutes.filter(function(r) { return r.route === currentRoute && r.bound === currentBound; })[0];
    if (!r0) return false;

    elRouteNum.textContent = currentRoute;
    var company = r0.company || 'KMB';
    elCompany.textContent = company;
    elCompany.className = 'route-badge ' + (company === 'KMB' ? 'kmb' : 'lwb');
    elRouteDir.textContent = (r0.orig_tc || '') + ' → ' + (r0.dest_tc || '');

    var opp = currentBound === 'O' ? 'I' : 'O';
    var oppData = allRoutes.filter(function(r) { return r.route === currentRoute && r.bound === opp; })[0];
    var html = '<button type="button" class="eta-dir-btn active" data-bound="' + esc(currentBound) + '">' +
      esc(r0.dest_tc ? '往 ' + r0.dest_tc : currentBound) + '</button>';
    if (oppData) {
      html += '<button type="button" class="eta-dir-btn" data-bound="' + esc(opp) + '">' +
        esc(oppData.dest_tc ? '往 ' + oppData.dest_tc : opp) + '</button>';
    }
    elDirToggle.innerHTML = html;
    return true;
  }

  function loadRoute(route, bound) {
    currentRoute = route;
    currentBound = bound || 'O';
    var r0 = allRoutes.filter(function(r) { return r.route === route && r.bound === currentBound; })[0];
    if (!r0) {
      elLoading.hidden = true;
      elMissing.hidden = false;
      return;
    }
    nodes = buildNodes(r0.stops);
    seqList = nodes.map(function(n) { return n.seq; });
    rowH = computeRowH();
    showAll = false;
    etaMap = {};
    markers = [];
    elBuses.innerHTML = '';

    if (!renderRouteHeader()) {
      elLoading.hidden = true;
      elMissing.hidden = false;
      return;
    }

    restoreMyStop();
    elLoading.hidden = true;
    elMissing.hidden = true;
    elApp.hidden = false;

    renderRail();
    applyCollapse();
    fetchEta();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchEta, REFRESH_MS);

    try {
      history.replaceState(null, '', 'track.html?route=' + encodeURIComponent(route) + '&bound=' + encodeURIComponent(currentBound));
    } catch (e) {}
  }

  if (elDirToggle) {
    elDirToggle.addEventListener('click', function(e) {
      var btn = e.target.closest('.eta-dir-btn');
      if (!btn) return;
      var b = btn.getAttribute('data-bound');
      if (!b || b === currentBound) return;
      stopAnimation();
      loadRoute(currentRoute, b);
    });
  }

  if (elLocateBtn) elLocateBtn.addEventListener('click', doLocate);

  if (elCollapseBtn) {
    elCollapseBtn.addEventListener('click', function() {
      showAll = !showAll;
      applyCollapse();
    });
  }

  window.addEventListener('resize', function() {
    var nh = computeRowH();
    if (nh === rowH) return;
    rowH = nh;
    var rows = elRail.querySelectorAll('.track-row');
    for (var i = 0; i < rows.length; i++) rows[i].style.height = rowH + 'px';
    elRail.style.height = (nodes.length * rowH) + 'px';
    startAnimation();
  });

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) stopAnimation();
    else if (Object.keys(etaMap).length) startAnimation();
  });

  document.addEventListener('langchange', function() {
    updateCollapseBtn();
    renderStopEtas();
    renderMarkerEls();
    paintMarkers(Date.now());
  });

  fetch('data/bus-routes-index.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      allRoutes = data;
      var params = new URLSearchParams(window.location.search);
      var route = (params.get('route') || '').toUpperCase();
      var bound = params.get('bound') === 'I' ? 'I' : 'O';
      if (!route) {
        var last = null;
        try { last = localStorage.getItem('eta_last_route'); } catch (e) {}
        route = (last || '').toUpperCase();
      }
      if (!route) {
        elLoading.hidden = true;
        elMissing.hidden = false;
        return;
      }
      loadRoute(route, bound);
    })
    .catch(function() {
      elLoading.hidden = true;
      elMissing.hidden = false;
    });
})();
