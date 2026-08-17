'use strict';

const CACHE = 'nivonline-v11';
const ASSETS = ['./', './index.html', './app.css', './app.js', './config.js',
                './supabase.js', './jspdf.min.js', './manifest.webmanifest',
                './icon-180.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Alles zur Datenbank (Supabase) NIE aus dem Cache beantworten
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit || fetch(e.request).then(resp => {
        const copy = resp.clone();
        if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      })
    )
  );
});
