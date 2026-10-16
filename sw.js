// Service worker Tahfizh Pro v2: aplikasi penuh bisa dibuka tanpa internet.
// - Berkas milik sendiri (index.html, api.js, ikon): jaringan dulu (maks 4 dtk), cadangan dari cache.
// - Library CDN (Tailwind, Chart.js, jsPDF, font, dll): disimpan saat pertama dibuka online, lalu dipakai offline.
// - Data API (Apps Script) tidak lewat sini; cache datanya diurus api.js.
const CACHE = 'tahfizh-pwa-v3';
const SHELL = ['./', './index.html', './api.js', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon.png'];
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// ambil dengan mode CORS agar hasilnya bisa dicek dan tidak boros kuota (opaque makan ruang besar)
const corsFetch = url => fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));

async function precacheCdn(cache) {
  for (const url of CDN) {
    try {
      const res = await corsFetch(url);
      if (!res.ok) continue;
      await cache.put(url, res.clone());
      if (/\.css|css2\?/.test(url)) { // simpan juga berkas font (woff2) yang disebut di CSS
        const css = await res.text();
        const fonts = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, '').trim())
          .filter(u => /\.woff2(\?|$)/.test(u)).map(u => new URL(u, url).href);
        for (const f of fonts) { try { const r = await corsFetch(f); if (r.ok) await cache.put(f, r); } catch (e) {} }
      }
    } catch (e) { /* gagal satu library tidak membatalkan pemasangan */ }
  }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => {}))); // berkas hilang tidak menggagalkan install
    await precacheCdn(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function networkFirst(req, key, ms) {
  return new Promise(resolve => {
    let settled = false;
    const useCache = () => caches.match(key || req, { ignoreSearch: true }).then(hit => { if (!settled) { settled = true; resolve(hit || Response.error()); } });
    const timer = setTimeout(useCache, ms);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key || req, copy)); }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => { clearTimeout(timer); useCache(); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, './index.html', 4000)); return; }
    e.respondWith(networkFirst(req, null, 4000));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) { // cache dulu, perbarui di belakang layar
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req.url);
      const refresh = corsFetch(req.url).then(res => { if (res.ok) cache.put(req.url, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(refresh); return hit; }
      return (await refresh) || fetch(req).catch(() => Response.error());
    })());
  }
  // lainnya (Apps Script / Google) langsung ke jaringan
});
