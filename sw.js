/* ═══════════════════════════════════════════════════════════
   海证 OceanProof — Service Worker
   站点零网络请求（数据与模型全部内置于 JS），cache-first
   即可完整离线运行。改版时把 CACHE 版本号 +1。
   ═══════════════════════════════════════════════════════════ */
var CACHE = 'oceanproof-v3';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './data.js',
  './admin.js',
  './boundary.js',
  './land.js',
  './prices.js',
  './currents.js',
  './model.js',
  './atmos_f.js',
  './manifest-data.js',
  './field.js',
  './flowmap.js',
  './app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
      .catch(function (err) { console.warn('[sw] 预缓存失败', err); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 本站无外链，防御性判断

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;

      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 离线且缓存未命中：导航请求回退到首页
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
