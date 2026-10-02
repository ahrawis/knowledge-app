// Offline: arquivos do app com rede primeiro (pega versão nova) e cache como reserva; fontes com cache primeiro.
// Chamadas à API do GitHub não passam pelo cache (as notas ficam no IndexedDB).
const VERSAO = 'knowledge-v1';
const SHELL = ['./', './index.html', './core.js', './store.js', './manifest.webmanifest', './demo.json',
  './vendor/js-yaml.mjs', './vendor/marked.esm.js', './vendor/purify.es.mjs', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function guardar(req, resp) {
  if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
  return resp;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => guardar(e.request, r)).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => guardar(e.request, r))));
  }
});
