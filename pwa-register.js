// SadSat Film PWA Service Worker & Client Auto-Update Controller
const SADSAT_BUILD_VERSION = '2.2.0';

if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    // 1. Proactive Self-Healing Cache Purge:
    // If client visited an older version, wipe stale CacheStorage so new changes take effect instantly.
    try {
        const cachedVer = localStorage.getItem('sadsat_app_build_ver');
        if (cachedVer !== SADSAT_BUILD_VERSION) {
            localStorage.setItem('sadsat_app_build_ver', SADSAT_BUILD_VERSION);
            if ('caches' in window) {
                caches.keys().then((names) => {
                    return Promise.all(names.map(name => {
                        console.log('SadSat: Purging stale client cache:', name);
                        return caches.delete(name);
                    }));
                }).catch(() => {});
            }
        }
    } catch (_) {}

    // 2. Register Service Worker with version query and update check
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js?v=' + SADSAT_BUILD_VERSION).then((reg) => {
            console.log('SadSat Film SW registered:', reg.scope);
            // Proactively check for an updated worker on every load
            reg.update().catch(() => {});

            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('SadSat: New version installed, activating immediately...');
                            newWorker.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                }
            });
        }).catch((err) => {
            console.warn('SadSat Film SW registration failed:', err);
        });

        // 3. Smooth auto-reload when a new Service Worker takes control
        let isReloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!isReloading) {
                isReloading = true;
                console.log('SadSat: Controller updated, reloading for fresh assets...');
                window.location.reload();
            }
        });
    });
}
