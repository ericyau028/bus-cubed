/* track.js — 實時巴士追蹤：路線軌跡 + 巴士位置推算動畫
 * 資料來源：data/bus-routes-index.json（站序）+ 運輸署 route-eta API（到站時間）
 * 限制：API 只提供「預測到站時間」，非車輛 GPS；位置由相鄰站 ETA 線性內插推算。
 */
(function() {
  'use strict';

  var API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb/route-eta/';
  var REFRESH_MS = 10000;
  var COLLAPSE_THRESHOLD = 30;
  var COLLAPSE_SPAN = 3;

  var allRoutes = [];
  var currentRoute = null;
  var currentBound = 'O';
  var nodes = [];
  var seqList = [];
  var rowH = 56;
  var anchors = {};
  var busCount = 0;
  var myStop = null;
  var userLoc = null;
  var stopsMin = null;
  var stopsMinPromise = null;
  var refreshTimer = null;
  var rafId = null;
  var isFetching = false;
  var showAll = false;
  var lastFetchAt = 0;

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var elLoading = document.getElementById('track-loading');
  var elMissing = document.getElementById('track-missing');
  var elApp = document.getElementById('track-app');
  var elRouteNum = document.getElementById('track-route-number');
  var elCompany = document.getElementById('track-company-badge');
  var elRouteDir = document.getElementById('track-route-dir');
  var elDirToggle = document.getElementById('track-direction-toggle');
  var elHero = document.getElementById('track-hero');
  var elHeroNum = document.getElementById('track-hero-num');
  var elHeroLabel = document.getElementById('track-hero-label');
  var elHeroSub = document.getElementById('track-hero-sub');
  var elHeroProgress = document.getElementById('track-hero-progress');
  var elLocateBtn = document.getElementById('track-locate-btn');
  var elRail = document.getElementById('track-rail');
  var elRailScroll = document.getElementById('track-rail-scroll');
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

  function buildAnchors(etaRows) {
    var byBus = {};
    (etaRows || []).forEach(function(e) {
      if (e.dir !== currentBound || !e.eta) return;
      var j = parseInt(e.eta_seq, 10) || 1;
      var seq = parseInt(e.seq, 10);
      var ts = Date.parse(e.eta);
      if (isNaN(seq) || isNaN(ts)) return;
      if (!byBus[j]) byBus[j] = {};
      if (!byBus[j][seq] || ts < byBus[j][seq]) byBus[j][seq] = ts;
    });
    var out = {};
    Object.keys(byBus).forEach(function(j) {
      var arr = Object.keys(byBus[j]).map(function(s) {
        return { seq: parseInt(s, 10), t: byBus[j][s] };
      }).sort(function(a, b) { return a.seq - b.seq; });
      if (arr.length) out[j] = arr;
    });
    return out;
  }

  function segAvg(A) {
    var segs = [];
    for (var i = 1; i < A.length; i++) {
      if (A[i].seq > A[i - 1].seq && A[i].t > A[i - 1].t) {
        segs.push((A[i].t - A[i - 1].t) / (A[i].seq - A[i - 1].seq));
      }
    }
    if (!segs.length) return 150000;
    segs.sort(function(a, b) { return a - b; });
    return segs[Math.floor(segs.length / 2)];
  }

  function position(A, now) {
    if (!A || !A.length) return null;
    var first = A[0];
    var last = A[A.length - 1];
    var avg = segAvg(A);
    var p;
    if (now < first.t) {
      p = first.seq - (first.t - now) / avg;
    } else if (now >= last.t) {
      p = last.seq + (now - last.t) / avg;
    } else {
      var k = 0;
      while (k < A.length - 1 && now >= A[k + 1].t) k++;
      var span = A[k + 1].t - A[k].t;
      var frac = span > 0 ? (now - A[k].t) / span : 1;
      p = A[k].seq + frac * (A[k + 1].seq - A[k].seq);
    }
    var maxSeq = seqList.length ? seqList[seqList.length - 1] : 1;
    var minSeq = seqList.length ? seqList[0] : 0;
    return Math.min(Math.max(p, minSeq), maxSeq);
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
      var name = n.names.join(' ／ ');
      html += '<div class="track-row" data-i="' + i + '" data-seq="' + n.seq + '" style="height:' + rowH + 'px">' +
        '<span class="track-node" aria-hidden="true"></span>' +
        '<span class="track-seq">' + n.seq + '</span>' +
        '<span class="track-name">' + esc(name) + '</span>' +
        '<span class="track-eta" data-eta-seq="' + n.seq + '"></span>' +
      '</div>';
    }
    // remove old rows but keep progress line + buses overlay
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
    var rows2 = elRail.querySelectorAll('.track-row');
    if (rows2[idx]) rows2[idx].classList.add('is-mine');
  }

  function applyCollapse() {
    var rows = elRail.querySelectorAll('.track-row');
    if (!rows.length) return;
    if (showAll || nodes.length <= COLLAPSE_THRESHOLD) {
      for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-hidden');
      updateCollapseBtn();
      return;
    }
    var busIdx = 0;
    var p1 = anchors['1'] ? position(anchors['1'], Date.now()) : null;
    if (p1 !== null) busIdx = Math.floor(indexOfSeq(Math.floor(p1)));
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

  function renderBuses() {
    var html = '';
    var keys = Object.keys(anchors).sort(function(a, b) { return a - b; });
    busCount = keys.length;
    for (var i = 0; i < keys.length; i++) {
      var j = keys[i];
      var cls = 'track-bus bus-' + j;
      html += '<div class="' + cls + '" data-j="' + j + '" style="top:0">' +
        '<span class="track-bus-icon">🚌</span>' +
        '<span class="track-bus-tag">' + esc(currentRoute) + '</span>' +
      '</div>';
    }
    elBuses.innerHTML = html;
  }

  function renderStopEtas() {
    var cells = elRail.querySelectorAll('.track-eta');
    var now = Date.now();
    for (var i = 0; i < cells.length; i++) {
      var seq = parseInt(cells[i].getAttribute('data-eta-seq'), 10);
      var txt = '';
      var keys = Object.keys(anchors).sort(function(a, b) { return a - b; });
      for (var k = 0; k < keys.length && k < 3; k++) {
        var A = anchors[keys[k]];
        var hit = null;
        for (var m = 0; m < A.length; m++) { if (A[m].seq === seq) { hit = A[m]; break; } }
        if (!hit) continue;
        var mins = Math.round((hit.t - now) / 60000);
        if (mins < 0) continue;
        var cls = mins <= 0 ? 'red' : (mins <= 3 ? 'amber' : 'green');
        txt += '<span class="track-eta-val ' + cls + '">' + (mins <= 0 ? t('eta_lt_min') : mins + ' ' + t('eta_min')) + '</span>';
      }
      cells[i].innerHTML = txt || '<span class="track-eta-val gray">--</span>';
    }
  }

  function animateBuses() {
    var now = Date.now();
    var keys = Object.keys(anchors).sort(function(a, b) { return a - b; });
    var firstY = null;
    for (var i = 0; i < keys.length; i++) {
      var j = keys[i];
      var p = position(anchors[j], now);
      var marker = elBuses.querySelector('.track-bus[data-j="' + j + '"]');
      if (!marker) continue;
      if (p === null) { marker.style.display = 'none'; continue; }
      marker.style.display = '';
      var y = yOf(p) + rowH / 2 - 16;
      marker.style.transform = 'translate3d(0,' + y + 'px,0)';
      if (j === keys[0]) firstY = yOf(p);
    }
    if (elProgressLine) {
      elProgressLine.style.height = (firstY === null ? 0 : Math.max(0, firstY + rowH / 2)) + 'px';
    }
    updateHero(now);

    rafId = requestAnimationFrame(animateBuses);
  }

  function updateHero(now) {
    var keys = Object.keys(anchors).sort(function(a, b) { return a - b; });
    if (!keys.length) {
      elHeroNum.textContent = '--';
      elHeroLabel.textContent = t('track_no_eta');
      elHeroSub.textContent = '';
      return;
    }
    var mySeq = (myStop && myStop.route === currentRoute) ? parseInt(myStop.seq, 10) : null;
    if (mySeq === null) {
      elHeroNum.textContent = '--';
      elHeroLabel.textContent = t('track_tap_hint');
      elHeroSub.textContent = (myStop && myStop.name) ? myStop.name : '';
      // progress still meaningful: show bus1 progress
      var pb = position(anchors[keys[0]], now);
      if (pb !== null && elHeroProgress) {
        var lastSeq = seqList[seqList.length - 1];
        elHeroProgress.style.width = Math.max(0, Math.min(100, (pb / lastSeq) * 100)) + '%';
      }
      return;
    }
    var best = null;
    for (var i = 0; i < keys.length; i++) {
      var A = anchors[keys[i]];
      for (var m = 0; m < A.length; m++) {
        if (A[m].seq === mySeq && A[m].t > now) { best = { j: keys[i], t: A[m].t }; break; }
      }
      if (best) break;
    }
    if (best) {
      var mins = Math.round((best.t - now) / 60000);
      if (mins <= 0) {
        elHeroNum.textContent = t('track_soon');
        elHeroLabel.textContent = '';
      } else {
        elHeroNum.textContent = mins;
        elHeroLabel.textContent = t('eta_min');
      }
      elHeroSub.textContent = (myStop.name || '') + ' · ' + t('track_my_stop');
    } else {
      elHeroNum.textContent = t('track_arrived');
      elHeroLabel.textContent = '';
      elHeroSub.textContent = (myStop.name || '') + ' · ' + t('track_my_stop');
    }
    var pb2 = position(anchors[keys[0]], now);
    if (pb2 !== null && elHeroProgress) {
      var lastSeq2 = seqList[seqList.length - 1];
      elHeroProgress.style.width = Math.max(0, Math.min(100, (pb2 / lastSeq2) * 100)) + '%';
    }
  }

  function stopAnimation() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function startAnimation() {
    stopAnimation();
    if (reducedMotion) {
      // one-shot positioning, no continuous movement
      var now = Date.now();
      var keys = Object.keys(anchors).sort(function(a, b) { return a - b; });
      for (var i = 0; i < keys.length; i++) {
        var j = keys[i];
        var p = position(anchors[j], now);
        var marker = elBuses.querySelector('.track-bus[data-j="' + j + '"]');
        if (!marker || p === null) continue;
        marker.style.transform = 'translate3d(0,' + (yOf(p) + rowH / 2 - 16) + 'px,0)';
      }
      updateHero(now);
      return;
    }
    rafId = requestAnimationFrame(animateBuses);
  }

  /* ---------- fetch ---------- */

  function fetchEta() {
    if (isFetching || !currentRoute) return;
    isFetching = true;
    fetch(API_BASE + encodeURIComponent(currentRoute) + '/1')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        anchors = buildAnchors((d && d.data) || []);
        lastFetchAt = Date.now();
        renderBuses();
        renderStopEtas();
        applyCollapse();
        startAnimation();
      })
      .catch(function() {
        if (!Object.keys(anchors).length) {
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
        .then(function(d) { stopsMin = d; return d; })
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
    if (elLocateBtn) elLocateBtn.disabled = true;
    var original = elLocateBtn ? elLocateBtn.innerHTML : '';
    if (elLocateBtn) elLocateBtn.textContent = t('track_locating');
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
        } else {
          if (elHeroSub) elHeroSub.textContent = t('track_not_on_route', { n: Math.round(best.dist) });
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
    var r1 = allRoutes.filter(function(r) { return r.route === currentRoute && r.bound !== currentBound; })[0];
    if (!r0) return false;

    elRouteNum.textContent = currentRoute;
    var company = r0.company || 'KMB';
    elCompany.textContent = company;
    elCompany.className = 'route-badge ' + (company === 'KMB' ? 'kmb' : 'lwb');
    elRouteDir.textContent = (r0.orig_tc || '') + ' → ' + (r0.dest_tc || '');

    var html = '';
    var opp = r0.bound === 'O' ? 'I' : 'O';
    var oppData = allRoutes.filter(function(r) { return r.route === currentRoute && r.bound === opp; })[0];
    html += '<button type="button" class="eta-dir-btn active" data-bound="' + esc(currentBound) + '">' + esc((r0.dest_tc ? '往 ' + r0.dest_tc : currentBound)) + '</button>';
    if (oppData) {
      html += '<button type="button" class="eta-dir-btn" data-bound="' + esc(opp) + '">' + esc((oppData.dest_tc ? '往 ' + oppData.dest_tc : opp)) + '</button>';
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
    anchors = {};
    busCount = 0;

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
    renderBuses();
    applyCollapse();
    fetchEta();

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchEta, REFRESH_MS);

    history.replaceState(null, '', 'track.html?route=' + encodeURIComponent(route) + '&bound=' + encodeURIComponent(currentBound));
  }

  // direction toggle (delegated)
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
    else if (Object.keys(anchors).length) startAnimation();
  });

  document.addEventListener('langchange', function() {
    updateCollapseBtn();
    renderStopEtas();
    updateHero(Date.now());
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
