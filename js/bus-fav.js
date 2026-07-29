(function() {
  'use strict';

  var state = {
    items: [],
    etaCache: {},
    routes: [],
    stopsIndex: {},
    intervals: {},
    timer: null,
    selectedRoute: null,
    selectedBound: null,
    selectedStops: [],
    step: 1
  };

  function init() {
    state.items = JSON.parse(localStorage.getItem('bus_favorites') || '[]');
    state.etaCache = JSON.parse(localStorage.getItem('bus_eta_cache') || '{}');

    Promise.all([
      fetch('../data/bus-routes-index.json').then(function(r) { return r.json(); }),
      fetch('../data/bus-stops-index.json').then(function(r) { return r.json(); })
    ]).then(function(results) {
      state.routes = results[0];
      state.stopsIndex = results[1];
      render();
    }).catch(function() {
      document.getElementById('fav-grid').innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-500);">⚠️ 無法載入路線資料</div>';
    });
  }

  function render() {
    if (state.items.length === 0) {
      showEmpty();
      return;
    }
    showDashboard();
  }

  function showEmpty() {
    document.getElementById('fav-empty').style.display = '';
    document.getElementById('fav-dashboard').style.display = 'none';
    document.getElementById('fav-fab').style.display = '';
  }

  function showDashboard() {
    document.getElementById('fav-empty').style.display = 'none';
    document.getElementById('fav-dashboard').style.display = '';
    document.getElementById('fav-fab').style.display = '';
    buildCards();
    startIntervals();
    if (!state.timer) startTimestampUpdater();
  }

  function buildCards() {
    var grid = document.getElementById('fav-grid');
    grid.innerHTML = '';
    state.items.forEach(function(fav, i) {
      var card = createCard(fav, i);
      grid.appendChild(card);
      setTimeout(function() { fetchETA(i); }, i * 200 + 100);
    });
  }

  function createCard(fav, index) {
    var card = document.createElement('div');
    card.className = 'fav-card';
    card.setAttribute('data-index', index);
    card.style.setProperty('--delay', (index * 0.07) + 's');
    setTimeout(function() { card.classList.add('revealed'); }, 50);

    var isKMB = fav.company !== 'LWB';
    var routeDir = (fav.route_orig_tc || '') + ' → ' + (fav.route_dest_tc || '');
    var stopName = (fav.stop_name_tc || '').replace(/\s*\([^)]*\)$/, '');

    card.innerHTML =
      '<div class="fav-card-header">' +
        '<span class="fav-route"><span class="fav-route-icon">🚌</span>' + esc(fav.route) + ' <small class="fav-route-dir">' + esc(routeDir) + '</small></span>' +
        '<span class="fav-badge ' + (isKMB ? 'kmb' : 'lwb') + '">' + (isKMB ? 'KMB' : 'LWB') + '</span>' +
      '</div>' +
      '<div class="fav-card-stop">🚏 ' + esc(stopName) + ' <span class="fav-stop-id">#' + esc(fav.stop_id) + '</span></div>' +
      '<div class="fav-card-eta" data-index="' + index + '">' +
        '<div class="fav-eta-skeleton"></div>' +
        '<div class="fav-eta-skeleton" style="width:70px;margin-top:4px;"></div>' +
        '<div class="fav-eta-skeleton" style="width:50px;margin-top:4px;"></div>' +
      '</div>' +
      '<div class="fav-card-footer">' +
        '<span class="fav-last-update"></span>' +
        '<div>' +
          '<button class="fav-card-remove" onclick="FAV_remove(' + index + ')" title="移除">✕ ' + LANG.t('bus_fav_remove') + '</button>' +
        '</div>' +
      '</div>';

    return card;
  }

  function fetchETA(index) {
    var fav = state.items[index];
    if (!fav) return;
    var card = document.querySelector('.fav-card[data-index="' + index + '"]');
    if (!card) return;
    var etaArea = card.querySelector('.fav-card-eta');
    var key = fav.route + '_' + fav.bound + '_' + fav.stop_seq;

    if (state.etaCache[key]) {
      renderETA(etaArea, state.etaCache[key].data, true);
    }

    var url = 'https://data.etabus.gov.hk/v1/transport/kmb/eta/' +
      encodeURIComponent(fav.stop_id) + '/' +
      encodeURIComponent(fav.route) + '/1';

    var loaded = false;
    setTimeout(function() {
      if (!loaded) {
        renderETAError(etaArea, true);
      }
    }, 8000);

    function doFetch(tryNum) {
      if (tryNum > 2) { if (!loaded) renderETAError(etaArea); return; }
      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (loaded) return;
          loaded = true;
          var etas = (data && data.data) || [];
          var filtered = etas.filter(function(e) { return e.dir === fav.bound; });
          if (filtered.length > 0 || !state.etaCache[key]) {
            state.etaCache[key] = { data: filtered, ts: Date.now() };
            try { localStorage.setItem('bus_eta_cache', JSON.stringify(state.etaCache)); } catch(e) {}
          }
          renderETA(etaArea, filtered, false);
          var lu = card.querySelector('.fav-last-update');
          if (lu) { lu.textContent = LANG.t('bus_fav_just_now'); lu.classList.add('fav-updated-now'); }
        })
        .catch(function() {
          if (!state.etaCache[key]) {
            if (tryNum < 2) { setTimeout(function() { doFetch(tryNum + 1); }, 2000); }
            else if (!loaded) { renderETAError(etaArea); }
          } else if (!loaded) {
            renderETA(etaArea, state.etaCache[key].data, true);
          }
        });
    }

    doFetch(0);
  }

  function renderETA(el, etas, isStale) {
    var now = new Date();
    var upcoming = etas.filter(function(e) {
      return e.eta && new Date(e.eta) > now;
    }).slice(0, 3);

    var html = '';
    if (upcoming.length === 0) {
      html = '<div class="fav-eta-row"><span class="fav-eta-value gray">' + LANG.t('bus_fav_no_eta') + '</span></div>';
    } else {
      var labels = [LANG.t('bus_fav_next'), LANG.t('bus_fav_following'), LANG.t('bus_fav_third')];
      upcoming.forEach(function(eta, i) {
        var mins = Math.round((new Date(eta.eta) - now) / 60000);
        var cls = 'green';
        var pulse = '';
        var text;
        if (mins <= 0) { cls = 'red'; pulse = 'fav-eta-pulse'; text = LANG.t('bus_fav_due') + ' 🔴'; }
        else if (mins <= 2) { cls = 'amber'; pulse = 'fav-eta-pulse'; text = LANG.t('bus_fav_arriving') + ' 🟡'; }
        else { text = mins + ' ' + LANG.t('bus_fav_min') + ' 🟢'; }
        html += '<div class="fav-eta-row">' +
          '<span class="fav-eta-label">' + labels[i] + ':</span>' +
          '<span class="fav-eta-value ' + cls + ' ' + pulse + '">' + text + '</span>' +
        '</div>';
      });
    }
    el.innerHTML = html;
  }

  function renderETAError(el, isTimeout) {
    el.innerHTML = '<div class="fav-eta-row" style="justify-content:space-between;">' +
      '<span class="fav-eta-value gray">⚠️ ' + (isTimeout ? '連線逾時' : LANG.t('bus_fav_error')) + '</span>' +
      '<button class="fav-card-retry" onclick="FAV_retry(this)">🔄 ' + LANG.t('bus_fav_retry') + '</button>' +
    '</div>';
  }

  function startIntervals() {
    Object.keys(state.intervals).forEach(function(k) { clearInterval(state.intervals[k]); });
    state.intervals = {};

    state.items.forEach(function(fav, i) {
      var key = fav.route + '_' + fav.bound + '_' + fav.stop_id;
      state.intervals[key] = setInterval(function() {
        fetchETA(i);
      }, 10000);
    });
  }

  function startTimestampUpdater() {
    state.timer = setInterval(function() {
      document.querySelectorAll('.fav-card').forEach(function(card) {
        var idx = parseInt(card.getAttribute('data-index'));
        var fav = state.items[idx];
        if (!fav) return;
        var key = fav.route + '_' + fav.bound + '_' + fav.stop_seq;
        var cache = state.etaCache[key];
        if (cache && cache.ts) {
          var secs = Math.round((Date.now() - cache.ts) / 1000);
          var el = card.querySelector('.fav-last-update');
          if (el) {
            if (secs < 5) el.textContent = LANG.t('bus_fav_just_now');
            else el.textContent = LANG.t('bus_fav_last_update', { n: secs });
          }
        }
      });
    }, 10000);
  }

  window.FAV_add = function(route, bound, stopId, stopName, stopSeq, routeOrig, routeDest, company) {
    var dup = state.items.some(function(f) {
      return f.route === route && f.stop_id === stopId;
    });
    if (dup) { alert(LANG.t('bus_fav_duplicate')); return false; }
    state.items.push({
      route: route, bound: bound, stop_id: stopId,
      stop_name_tc: stopName, stop_seq: stopSeq,
      route_orig_tc: routeOrig, route_dest_tc: routeDest,
      company: company || 'KMB'
    });
    save();
    if (state.items.length === 1) render();
    else {
      var newIndex = state.items.length - 1;
      var grid = document.getElementById('fav-grid');
      var card = createCard(state.items[newIndex], newIndex);
      grid.appendChild(card);
      var fav = state.items[newIndex];
      var ikey = fav.route + '_' + fav.bound + '_' + fav.stop_id;
      state.intervals[ikey] = setInterval(function() {
        fetchETA(newIndex);
      }, 10000);
      setTimeout(function() {
        card.classList.add('revealed');
        fetchETA(newIndex);
      }, 100);
    }
    return true;
  };

  window.FAV_remove = function(index) {
    var fav = state.items[index];
    if (!fav) return;
    state.items.splice(index, 1);
    save();
    if (state.items.length === 0) { showEmpty(); return; }
    buildCards();
    startIntervals();
  };

  window.FAV_retry = function(btn) {
    var card = btn.closest('.fav-card');
    if (!card) return;
    var idx = parseInt(card.getAttribute('data-index'));
    fetchETA(idx);
  };

  function save() {
    try { localStorage.setItem('bus_favorites', JSON.stringify(state.items)); } catch(e) {}
  }

  window.FAV_openModal = function() {
    state.step = 1;
    state.selectedRoute = null;
    state.selectedBound = null;
    state.selectedStops = [];
    document.getElementById('fav-modal').classList.add('open');
    showStep(1);
    document.getElementById('fav-route-input').value = '';
    document.getElementById('fav-route-suggestions').classList.remove('show');
  };

  window.FAV_closeModal = function() {
    document.getElementById('fav-modal').classList.remove('open');
  };

  function showStep(n) {
    state.step = n;
    document.querySelectorAll('.fav-step-panel').forEach(function(el, i) {
      el.classList.toggle('active', i === n - 1);
    });
    document.querySelectorAll('.fav-step-dot').forEach(function(el, i) {
      el.classList.toggle('active', i === n - 1);
      el.classList.toggle('done', i < n - 1);
    });
    if (n === 1) document.getElementById('fav-route-input').focus();
    updateStepBtns();
  }

  function updateStepBtns() {
    var back = document.getElementById('fav-step-back');
    var next = document.getElementById('fav-step-next');
    var s = state.step;
    back.style.display = s > 1 ? '' : 'none';
    if (s === 1) {
      next.textContent = LANG.t('bus_fav_next_step');
      next.disabled = !state.selectedRoute;
      next.className = 'fav-step-btn primary';
    } else if (s === 2) {
      next.textContent = LANG.t('bus_fav_next_step');
      var dirSelected = document.querySelector('#fav-dir-container .fav-dir-btn.selected');
      next.disabled = !dirSelected;
      next.className = 'fav-step-btn primary';
    } else if (s === 3) {
      next.textContent = state.selectedStops.length > 0
        ? LANG.t('bus_fav_save') + ' (' + state.selectedStops.length + ')'
        : LANG.t('bus_fav_save');
      next.disabled = state.selectedStops.length === 0;
      next.className = 'fav-step-btn success';
    }
  }

  window.FAV_nextStep = function() {
    if (state.step === 2) {
      if (!state.selectedRoute.bound) return;
      showStep(3);
      loadStops();
      return;
    }
    if (state.step === 3) {
      state.selectedStops.forEach(function(stop) {
        window.FAV_add(
          state.selectedRoute.route,
          state.selectedRoute.bound,
          stop.stop_id,
          stop.name_tc,
          stop.seq,
          state.selectedRoute.orig_tc,
          state.selectedRoute.dest_tc,
          state.selectedRoute.company
        );
      });
      window.FAV_closeModal();
      return;
    }
    showStep(state.step + 1);
  };

  window.FAV_prevStep = function() {
    showStep(state.step - 1);
  };

  window.FAV_searchRoute = function(val) {
    var sug = document.getElementById('fav-route-suggestions');
    if (!val.trim()) { sug.classList.remove('show'); return; }
    var q = val.trim().toLowerCase();
    var matches = [];
    state.routes.forEach(function(r) {
      if (r.route.toLowerCase().indexOf(q) !== -1) {
        if (!matches.some(function(m) { return m.route === r.route; })) {
          matches.push(r);
        }
      }
    });
    if (matches.length === 0) { sug.classList.remove('show'); return; }
    sug.innerHTML = matches.slice(0, 10).map(function(r) {
      var dir = (r.orig_tc || '') + ' → ' + (r.dest_tc || '');
      return '<div class="fav-route-sug" onclick="FAV_selectRoute(\'' +
        esc(r.route) + '\',\'' + esc(r.company || 'KMB') + '\',\'' +
        esc(r.orig_tc || '') + '\',\'' + esc(r.dest_tc || '') + '\')">' +
        '<span><span class="fav-route-sug-num">' + esc(r.route) + '</span><br><span class="fav-route-sug-dir">' + esc(dir) + '</span></span>' +
        '<span class="fav-badge ' + ((r.company || 'KMB') === 'KMB' ? 'kmb' : 'lwb') + '">' + (r.company || 'KMB') + '</span>' +
      '</div>';
    }).join('');
    sug.classList.add('show');
  };

  window.FAV_selectRoute = function(route, company, origTc, destTc) {
    state.selectedRoute = { route: route, company: company, orig_tc: origTc, dest_tc: destTc, bound: null };
    document.getElementById('fav-route-input').value = route + ' ' + origTc + ' → ' + destTc;
    document.getElementById('fav-route-suggestions').classList.remove('show');

    var dirs = state.routes.filter(function(r) { return r.route === route; });
    var bounds = {};
    dirs.forEach(function(r) { bounds[r.bound] = r; });

    var container = document.getElementById('fav-dir-container');
    container.innerHTML = '';
    var boundsOrder = ['O', 'I'];
    boundsOrder.forEach(function(b) {
      if (bounds[b]) {
        var btn = document.createElement('button');
        btn.className = 'fav-dir-btn';
        btn.setAttribute('data-bound', b);
        btn.setAttribute('onclick', 'FAV_selectDirection(\'' + b + '\')');
        var label = (b === 'O' ? 'O 往 ' : 'I 往 ') + (bounds[b].dest_tc || '');
        var sub = (bounds[b].orig_tc || '') + ' → ' + (bounds[b].dest_tc || '');
        btn.innerHTML = label + '<small>' + sub + '</small>';
        container.appendChild(btn);
      }
    });
    if (container.innerHTML === '') {
      container.innerHTML = '<div style="color:var(--gray-400);text-align:center;padding:12px;">無可用方向資料</div>';
    }

    showStep(2);
  };

  window.FAV_selectDirection = function(bound) {
    if (state.selectedRoute) state.selectedRoute.bound = bound;
    document.querySelectorAll('.fav-dir-btn').forEach(function(b) {
      if (b.getAttribute('data-bound') === bound) {
        b.classList.add('selected');
      } else {
        b.classList.remove('selected');
      }
    });
    updateStepBtns();
  };

  function loadStops() {
    var r = state.selectedRoute;
    var container = document.getElementById('fav-stop-container');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">載入車站中...</div>';

    var routeData = state.routes.filter(function(x) {
      return x.route === r.route && x.bound === r.bound;
    });
    if (routeData.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">無可用車站資料</div>';
      return;
    }

    var stops = routeData[0].stops || [];
    if (stops.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-500);">無可用車站資料</div>';
      return;
    }

    container.innerHTML = '<div id="fav-stop-list" class="fav-stop-list"></div>' +
      '<div class="fav-sel-count" id="fav-sel-count">已選擇 0 個車站</div>';

    var list = document.getElementById('fav-stop-list');
    stops.forEach(function(s, i) {
      var item = document.createElement('div');
      item.className = 'fav-stop-item';
      item.setAttribute('data-seq', s.seq);
      item.setAttribute('data-stop-id', s.stop_id);
      item.setAttribute('data-name', s.name_tc || '');
      item.innerHTML =
        '<input type="checkbox">' +
        '<span class="fav-stop-seq">' + (i + 1) + '.</span>' +
        '<span class="fav-stop-name">' + esc(s.name_tc || '') + '</span>' +
        '<span class="fav-stop-checked">✓</span>';
      item.querySelector('input').addEventListener('change', function() {
        item.classList.toggle('selected', this.checked);
        updateSelectedStops();
      });
      list.appendChild(item);
    });
  }

  function updateSelectedStops() {
    var items = document.querySelectorAll('#fav-stop-list .fav-stop-item.selected');
    state.selectedStops = [];
    items.forEach(function(item) {
      state.selectedStops.push({
        seq: item.getAttribute('data-seq'),
        stop_id: item.getAttribute('data-stop-id'),
        name_tc: item.getAttribute('data-name')
      });
    });
    document.getElementById('fav-sel-count').textContent =
      LANG.t('bus_fav_selected').replace('{n}', state.selectedStops.length);
    updateStepBtns();
  }

  window.FAV_searchStops = function(val) {
    var items = document.querySelectorAll('#fav-stop-list .fav-stop-item');
    var q = val.trim().toLowerCase();
    items.forEach(function(item) {
      var name = (item.getAttribute('data-name') || '').toLowerCase();
      item.style.display = (!q || name.indexOf(q) !== -1) ? '' : 'none';
    });
  };

  document.addEventListener('langchange', function() {
    if (state.items.length === 0) {
      document.querySelector('[data-i18n="bus_fav_empty_title"]');
    }
  });

  document.addEventListener('DOMContentLoaded', init);

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

})();
