/* Service Worker - 香港巴士便利站 PWA
 * 快取策略：
 *  - 靜態資源 (css/js/html/icon)：Cache First
 *  - 資料檔 (data/*.json)：Network First（有網路即更新，離線用快取）
 *  - 外部 API：僅網路（不快取動態數據）
 */
const CACHE_NAME = 'bus-cubed-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './map.html',
  './list.html',
  './routes.html',
  './eta.html',
  './fav.html',
  './css/style.css',
  './css/bus-fav.css',
  './js/main.js',
  './js/i18n.js',
  './js/search.js',
  './js/animations.js',
  './js/bus-fav.js',
  './js/eta.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 安裝：預先快取靜態資源
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(STATIC_ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

// 啟動：清理舊快取
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// 請求處理
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // 外部 API：不干預（讓頁面直接請求，快取策略交由頁面邏輯）
  if (url.origin !== self.location.origin) {
    return;
  }

  // 資料檔：Network First（離線時 fallback 到快取）
  if (url.pathname.indexOf('/data/') !== -1) {
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(event.request);
        })
    );
    return;
  }

  // 靜態資源：Cache First，離線可用
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.status === 200 && event.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
