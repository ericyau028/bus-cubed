/* ETA - 即時到站 */
(function() {
  'use strict';

  var routesData = null, stopsData = null, stopsObj = null;
  var currentRoute = null, currentBound = null, currentService = '1';
  var refreshTimer = null;

  // Load data
  function loadData(callback) {
    if (routesData && stopsData) { callback(); return; }
    Promise.all([
      fetch('data/bus-routes-index.json').then(function(r) { return r.json(); }),
      fetch('data/bus-stops-index.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
      routesData = results[0];
      stopsObj = results[1];
      stopsData = Object.keys(stopsObj).map(function(k) {
        var s = stopsObj[k]; s.stop_id = k; return s;
      });
      callback();
    });
  }

  // Search suggestions
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

  loadData(function() {
    // Search on input
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

    // Click suggestion
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

    // Find route info
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
    toggleDir.innerHTML = '<button class="eta-dir-btn" onclick="window.loadEta(\'' + route + '\',\'' + oppositeBound + '\')">🔄 ' +
      (oppositeBound === 'O' ? routeInfo.orig_tc + ' → ' + routeInfo.dest_tc : '另一方向') + '</button>';

    // Fetch ETA for each stop
    var stopIds = routeInfo.stops.map(function(s) { return s.stop_id; });
    var batchSize = 10;
    var allResults = [];

    function fetchBatch(idx) {
      if (idx >= stopIds.length) { renderResults(routeInfo.stops, allResults); return; }
      var batch = stopIds.slice(idx, idx + batchSize);
      var promises = batch.map(function(sid) {
        return fetch('https://data.etabus.gov.hk/v1/transport/kmb/eta/' + sid + '/' + route + '/' + currentService)
          .then(function(r) { return r.json(); })
          .then(function(d) { return { stop_id: sid, data: d.data }; })
          .catch(function() { return { stop_id: sid, data: [] }; });
      });
      Promise.all(promises).then(function(results) {
        allResults = allResults.concat(results);
        fetchBatch(idx + batchSize);
      });
    }
    fetchBatch(0);

    // Auto refresh every 30s
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function() { loadEta(route, bound); }, 30000);
    updateTimestamp();
  }

  function renderResults(stops, etaResults) {
    var etaMap = {};
    etaResults.forEach(function(r) {
      if (r.data && r.data.length > 0) {
        etaMap[r.stop_id] = r.data.filter(function(d) { return d.eta; });
      }
    });

    var html = '';
    stops.forEach(function(s, i) {
      var eta = etaMap[s.stop_id];
      var etaText = '';
      if (eta && eta.length > 0) {
        var times = eta.map(function(e) { return formatEta(e.eta); }).filter(function(t) { return t; });
        etaText = times.slice(0, 3).join('<br>');
      } else {
        etaText = '<span class="eta-none">--</span>';
      }
      var name = s.name_tc || stopsObj[s.stop_id]?.name_tc || '';
      html += '<div class="eta-stop-row"><span class="eta-seq">' + (i + 1) + '</span><span class="eta-name">' + name + '</span><span class="eta-time">' + etaText + '</span></div>';
    });
    stopList.innerHTML = html;
  }

  function formatEta(isoStr) {
    if (!isoStr) return null;
    var eta = new Date(isoStr);
    var now = new Date();
    var diff = Math.round((eta - now) / 60000);
    if (diff < 0) return '即將';
    if (diff === 0) return '即將';
    if (diff < 60) return diff + ' 分';
    return eta.getHours().toString().padStart(2,'0') + ':' + eta.getMinutes().toString().padStart(2,'0');
  }

  function updateTimestamp() {
    if (refreshTS) refreshTS.textContent = '🔄 ' + new Date().toLocaleTimeString('zh-HK');
  }

  // Manual refresh
  var manualRefresh = document.getElementById('eta-manual-refresh');
  if (manualRefresh) {
    manualRefresh.addEventListener('click', function() {
      if (currentRoute) loadEta(currentRoute, currentBound);
    });
  }

  // Export for inline use
  window.loadEta = loadEta;
})();
