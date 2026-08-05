/* route-eta.js - 路線頁專用共享 ETA widget
 * 從 data-route / data-bound 讀取路線，透過運輸署 route-eta API 顯示所有車站即時到站時間。
 * 靜態 HTML 已含站點清單（SEO），此腳本僅在 widget 容器內補充即時時間。
 */
(function() {
  'use strict';

  var widgets = document.querySelectorAll('.route-eta-widget');
  if (widgets.length === 0) return;

  function formatMins(e) {
    var now = new Date();
    var mins = Math.round((new Date(e.eta) - now) / 60000);
    if (mins <= 0) return { text: '即將', cls: 'red' };
    if (mins <= 2) return { text: '即將到站', cls: 'amber' };
    return { text: mins + ' 分', cls: 'green' };
  }

  function render(widget, bound, allEta) {
    var list = widget.querySelector('.route-eta-stops');
    if (!list) return;
    var etaMap = {};
    (allEta || []).forEach(function(e) {
      if (e.dir !== bound) return;
      var seq = String(e.seq);
      if (!etaMap[seq]) etaMap[seq] = [];
      etaMap[seq].push(e);
    });
    var rows = widget.querySelectorAll('.route-eta-row');
    rows.forEach(function(row) {
      var seq = row.getAttribute('data-seq');
      var etas = (etaMap[seq] || []).filter(function(e) { return e.eta; });
      etas.sort(function(a, b) { return (a.eta_seq || 99) - (b.eta_seq || 99); });
      var cell = row.querySelector('.route-eta-time');
      if (!cell) return;
      if (etas.length === 0) {
        cell.innerHTML = '<span class="route-eta-val gray">--</span>';
        return;
      }
      var html = '';
      etas.slice(0, 3).forEach(function(e) {
        var f = formatMins(e);
        html += '<span class="route-eta-val ' + f.cls + '">' + f.text + '</span>';
      });
      cell.innerHTML = html;
    });
  }

  function loadWidget(widget) {
    var route = widget.getAttribute('data-route');
    var bound = widget.getAttribute('data-bound') || 'O';
    var list = widget.querySelector('.route-eta-stops');
    if (!list) return;
    list.innerHTML = '<div class="route-eta-loading">載入到站時間中…</div>';
    var isCtb = widget.getAttribute('data-ctb') === '1';
    var url = 'https://data.etabus.gov.hk/v1/transport/kmb/route-eta/' + encodeURIComponent(route) + '/1';
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var allEta = (d && d.data) || [];
        list.innerHTML = '';
        var stopsHtml = '';
        var routeData = null;
        // stops come from data/bus-routes-index.json static list; we embed seq in widgets
        var seqList = widget.getAttribute('data-seqlist');
        var names = widget.getAttribute('data-names');
        var seqs = seqList ? seqList.split(',') : [];
        var nm = names ? names.split('|') : [];
        for (var i = 0; i < seqs.length; i++) {
          stopsHtml += '<div class="route-eta-row" data-seq="' + seqs[i] + '">' +
            '<span class="route-eta-idx">' + (i + 1) + '</span>' +
            '<span class="route-eta-name">' + (nm[i] || '') + '</span>' +
            '<span class="route-eta-time"><span class="route-eta-val gray">--</span></span></div>';
        }
        if (isCtb && allEta.length === 0) {
          stopsHtml += '<div class="route-eta-error">此路線由城巴營運，即時到站請以城巴 App／車站顯示屏為準。</div>';
        }
        list.innerHTML = stopsHtml;
        render(widget, bound, allEta);
      })
      .catch(function() {
        list.innerHTML = '<div class="route-eta-error">⚠️ 無法取得到站時間，請稍後重試。</div>';
      });
  }

  widgets.forEach(loadWidget);
  setInterval(function() {
    widgets.forEach(function(w) {
      if (w.getAttribute('data-ctb') === '1') return;
      var route = w.getAttribute('data-route');
      var bound = w.getAttribute('data-bound') || 'O';
      var url = 'https://data.etabus.gov.hk/v1/transport/kmb/route-eta/' + encodeURIComponent(route) + '/1';
      fetch(url).then(function(r) { return r.json(); }).then(function(d) {
        render(w, bound, (d && d.data) || []);
      }).catch(function() {});
    });
  }, 30000);
})();