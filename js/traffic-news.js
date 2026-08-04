(function() {
  'use strict';

  function init() {
    var container = document.getElementById('traffic-news');
    if (!container) return;
    container.innerHTML =
      '<div class="traffic-news-inner">' +
        '<span class="traffic-news-icon">🚨</span>' +
        '<span class="traffic-news-text">' + (window.TRAFFIC_LANG && TRAFFIC_LANG.loading || '載入特別交通消息...') + '</span>' +
      '</div>';
    fetch('https://resource.data.one.gov.hk/td/tc/specialtrafficnews.xml')
      .then(function(r) { if (!r.ok) throw new Error('http'); return r.text(); })
      .then(function(xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        var messages = doc.getElementsByTagName('message');
        var active = [];
        for (var i = 0; i < messages.length; i++) {
          var m = messages[i];
          var status = getTag(m, 'CurrentStatus');
          // CurrentStatus 2 = active; also show 1 (in effect)
          if (status === '2' || status === '1') {
            var text = getTag(m, 'ChinText');
            if (text) active.push(text);
          }
        }
        if (active.length === 0) {
          container.style.display = 'none';
          return;
        }
        var text = window.TRAFFIC_LANG && TRAFFIC_LANG.title || '特別交通消息';
        container.innerHTML =
          '<div class="traffic-news-inner">' +
            '<span class="traffic-news-icon">🚨</span>' +
            '<div class="traffic-news-body">' +
              '<div class="traffic-news-title">' + text + ' (' + active.length + ')</div>' +
              '<ul class="traffic-news-list">' +
                active.slice(0, 4).map(function(t) { return '<li>' + t + '</li>'; }).join('') +
              '</ul>' +
            '</div>' +
          '</div>';
        container.style.display = 'block';
      })
      .catch(function() {
        container.style.display = 'none';
      });
  }

  function getTag(parent, name) {
    var els = parent.getElementsByTagName(name);
    if (els.length === 0) return '';
    return (els[0].textContent || '').trim();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();