const CACHE_NAME = 'sadsat-film-v2.2'; // supersedes sadsat-film-v1.1
const STATIC_ASSETS = [
    '/favicon.ico',
    '/images/icon-192.png',
    '/images/icon-512.png',
    '/fonts/Vazirmatn-Regular.woff2',
    '/fonts/Vazirmatn-Bold.woff2'
];

self.addEventListener('install', (event) => {
    // Immediately activate new service worker
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(err => console.warn('Cache addAll warning:', err));
        })
    );
});

self.addEventListener('activate', (event) => {
    // Purge ALL stale caches from previous versions
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('SadSat SW: purging stale cache', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    // Only intercept GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    if (!event.request.url.startsWith('http')) {
        return;
    }

    const url = new URL(event.request.url);

    // Bypass video streams, MKV downloads, byte range requests, and API calls completely
    if (url.pathname.endsWith('.mkv') ||
        url.pathname.endsWith('.mp4') ||
        url.pathname.endsWith('.webm') ||
        event.request.headers.get('range') ||
        url.pathname.startsWith('/api/')) {
        return;
    }

    // Never cache or intercept sw.js or pwa-register.js
    if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/pwa-register.js')) {
        return;
    }

    // Cache-first ONLY for immutable fonts and static app icons
    if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/images/icon-')) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // NETWORK-FIRST for HTML pages, CSS, and JS:
    // Always fetch the latest version from network.
    // Fall back to cache ONLY when user is offline or network fails.
    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
                const clone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
        }).catch(() => {
            return caches.match(event.request);
        })
    );
});
