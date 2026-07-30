/* セーノ！ Service Worker
   方針：常にネットワークを先に見る（network-first）。
   → こちらでコードを更新したら、次に開いた時に必ず最新版になる。
     オフライン時だけキャッシュから出すので、電波が悪くても起動はする。 */

const CACHE = 'synctap-v5';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './mqtt.min.js',
  './manifest.webmanifest',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();                       // 新しいSWをすぐ有効化
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();             // 開いているタブをすぐ乗っ取る
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 外部(ブローカー等)は素通し
  // 音楽ファイルはブラウザに任せる。途中再生の Range リクエスト(206)は Cache API に入れられないうえ、
  // 毎回ダウンロードし直すと通信量がもったいないため。
  if (url.pathname.endsWith('.mp3') || url.pathname.startsWith('/music/')) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const idx = await caches.match('./index.html');
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
