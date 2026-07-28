/* ETA - 即時到站 */
(function() {
  'use strict';

  var routesData = null, stopsObj = null;
  var currentRoute = null, currentBound = null;
  var refreshTimer = null;

  var searchInput = document.getElementById('eta-search-input');
  var suggestions = document.getElementById('eta-suggestions');
  var content = document.getElementById('eta-content');
  var empty = document.getElementById('eta-empty');
  var routeNumber = document.getElementById('eta-route-number');
  var routeDir = document.getElementById('eta-route-dir');
  var stopsCount = document.getElementById('eta-stops-count');
  var toggleDir = document.getElementById('eta-direction-toggle');
  var stopList = document.getElementById('eta-stop-list');
  var refreshTS = document.getElementById('eta-refresh-timestamp');

  if (!searchInput) return;

  // Load data
  function loadData(callback) {
    if (routesData) { callback(); return; }
    Promise.all([
      fetch('data/bus-routes-index.json').then(function(r) { return r.json(); }),
      fetch('data/bus-stops-index.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
      routesData = results[0];
      stopsObj = results[1];
      callback();
    });
  }

  loadData(function() {
    searchInput.addEventListener('input', function() {
      var q = this.value.trim().toUpperCase();
      if (q.length < 1) { suggestions.style.display = 'none'; return; }
      var matches = [];
      var seen = {};
      routesData.forEach(function(r) {
        if (!seen[r.route] && r.route.indexOf(q) === 0) {
          seen[r.route] = true;
          matches.push(r);
        }
      });
      if (matches.length === 0) { suggestions.style.display = 'none'; return; }
      suggestions.style.display = 'block';
      suggestions.innerHTML = matches.slice(0, 15).map(function(r) {
        return '<div class="eta-suggestion-item" data-route="' + r.route + '" data-bound="' + r.bound + '">' +
          '<span class="eta-sug-route">' + r.route + '</span>' +
          '<span class="eta-sug-dest">' + r.orig_tc + ' → ' + r.dest_tc + '</span></div>';
      }).join('');
    });

    suggestions.addEventListener('click', function(e) {
      var item = e.target.closest('.eta-suggestion-item');
      if (!item) return;
      suggestions.style.display = 'none';
      searchInput.value = item.dataset.route;
      loadEta(item.dataset.route, item.dataset.bound);
    });
  });

  function loadEta(route, bound) {
    currentRoute = route; currentBound = bound;
    content.style.display = 'block';
    empty.style.display = 'none';
    stopList.innerHTML = '<div class="eta-skeleton-row"><div class="skeleton eta-skeleton-seq"></div><div class="skeleton eta-skeleton-name"></div><div class="skeleton eta-skeleton-eta"></div></div>'.repeat(5);

    var routeInfo = null;
    routesData.forEach(function(r) {
      if (r.route === route && r.bound === bound) routeInfo = r;
    });
    if (!routeInfo) return;

    routeNumber.textContent = route;
    routeDir.textContent = routeInfo.orig_tc + ' → ' + routeInfo.dest_tc;
    stopsCount.textContent = routeInfo.stops.length + ' 個站';

    // Direction toggle
    var oppositeBound = bound === 'O' ? 'I' : 'O';
    var oppInfo = null;
    routesData.forEach(function(r) {
      if (r.route === route && r.bound === oppositeBound) oppInfo = r;
    });
    if (oppInfo) {
      toggleDir.innerHTML = '<button class="eta-dir-btn" onclick="window.loadEta(\'' + route + '\',\'' + oppositeBound + '\')">🔄 ' + oppInfo.orig_tc + ' → ' + oppInfo.dest_tc + '</button>';
    } else {
      toggleDir.innerHTML = '';
    }

    // Fetch ETA - Route ETA API returns all stops' ETA for the route
    var url = 'https://data.etabus.gov.hk/v1/transport/kmb/route-eta/' +
      encodeURIComponent(route) + '/1';

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var etaData = (data && data.data) || [];
        // Route ETA returns both directions, filter by direction
        etaData = etaData.filter(function(e) { return e.dir === bound; });
        renderResults(routeInfo.stops, etaData);
      })
      .catch(function() {
        stopList.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">⚠️ 無法取得到站時間</div>';
      });

    // Auto refresh
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function() { loadEta(route, bound); }, 30000);
    updateTimestamp();
  }

  function renderResults(stops, etaData) {
    // Build map: seq (stop sequence) -> [eta entries]
    var etaMap = {};
    etaData.forEach(function(e) {
      var seq = String(e.seq);
      if (!etaMap[seq]) etaMap[seq] = [];
      etaMap[seq].push(e);
    });

    var html = '';
    stops.forEach(function(s, i) {
      var etas = etaMap[s.seq] || [];
      // Sort by eta_seq (next bus first)
      etas.sort(function(a, b) { return (a.eta_seq || 99) - (b.eta_seq || 99); });

      var etaText = '';
      if (etas.length > 0) {
        etaText = etas.slice(0, 3).map(function(e) {
          return formatEta(e.eta);
        }).filter(function(t) { return t; }).join('<br>');
      }
      if (!etaText) etaText = '<span class="eta-none">--</span>';

      var name = s.name_tc || (stopsObj[s.stop_id] ? stopsObj[s.stop_id].name_tc : '');
      html += '<div class="eta-stop-row">' +
        '<span class="eta-seq">' + (i + 1) + '</span>' +
        '<span class="eta-name">' + name + '</span>' +
        '<span class="eta-time">' + etaText + '</span></div>';
    });
    stopList.innerHTML = html;
  }

  function formatEta(val) {
    if (!val) return null;
    // If it's seconds (tt_sec)
    if (typeof val === 'number' || /^\d+$/.test(val)) {
      var secs = parseInt(val);
      if (secs < 0) return null;
      if (secs < 60) return '即將';
      var mins = Math.round(secs / 60);
      return mins + ' 分';
    }
    // If it's ISO timestamp
    var eta = new Date(val);
    var now = new Date();
    var diff = Math.round((eta - now) / 60000);
    if (diff < 0) return null;
    if (diff <= 1) return '即將';
    if (diff < 60) return diff + ' 分';
    return eta.getHours().toString().padStart(2,'0') + ':' + eta.getMinutes().toString().padStart(2,'0');
  }

  function updateTimestamp() {
    if (refreshTS) refreshTS.textContent = new Date().toLocaleTimeString('zh-HK');
  }

  var manualRefresh = document.getElementById('eta-manual-refresh');
  if (manualRefresh) {
    manualRefresh.addEventListener('click', function() {
      if (currentRoute) loadEta(currentRoute, currentBound);
    });
  }

  window.loadEta = loadEta;
})();
