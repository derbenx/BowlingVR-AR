const swEnabled = 1;

if (!swEnabled) {
    // --- SERVICE WORKER DISABLED ---

    self.addEventListener('install', (event) => {
        // Skip waiting to ensure the new (disabling) service worker activates quickly.
        console.log('Service Worker: Bypassing cache for disable.');
        self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
        console.log('Service Worker: Deactivating and unregistering.');
        event.waitUntil(
            (async () => {
                // 1. Unregister the service worker.
                await self.registration.unregister();

                // 2. Delete all caches.
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(cacheName => {
                    console.log('Deleting cache:', cacheName);
                    return caches.delete(cacheName);
                }));

                // 3. Force all clients to reload to shed the service worker.
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach((client) => {
                    // A simple reload is often the easiest way to ensure the page
                    // is no longer controlled by the (now unregistered) service worker.
                    client.navigate(client.url);
                });
            })()
        );
    });

} else {
    // --- SERVICE WORKER ENABLED ---

    const APP_PREFIX = 'gltf-viewer-';
    let CACHE_NAME = APP_PREFIX + 'v-initial'; // Initial cache name, will be updated.

    const PRECACHE_ASSETS = [
        './',
        'index.html',
        'manifest.json',
        'version.json',
        'main.js',
        '3d/bowling.glb',
        'js/three/build/three.module.js',
        'js/three/examples/jsm/loaders/GLTFLoader.js',
        'js/three/examples/jsm/webxr/ARButton.js',
        'js/three/examples/jsm/geometries/ConvexGeometry.js',
        'js/three/examples/jsm/webxr/XRPlanes.js',
        'js/three/examples/jsm/webxr/XRControllerModelFactory.js',
        'js/rapier/rapier.mjs',
        'js/rapier/rapier_wasm3d.js',
        'js/rapier/rapier_wasm3d_bg.wasm'
    ];

    self.addEventListener('install', event => {
        event.waitUntil(
            (async () => {
                console.log('Service Worker: Install event in progress.');

                // 1. Fetch version.json to get the dynamic version and key.
                const versionRequest = new Request('./version.json', { cache: 'no-store' });
                const versionResponse = await fetch(versionRequest);
                if (!versionResponse.ok) {
                    throw new Error('Could not fetch version.json. Aborting installation.');
                }
                const versionData = await versionResponse.json();

                // 2. Set the dynamic cache name and validate the key.
                CACHE_NAME = APP_PREFIX + 'v' + versionData.version;
                const expectedKey = '657327cf42df016f2c66621a0616db67ac894124be94844bro';
                if (versionData.key.trim() !== expectedKey) {
                    throw new Error(`Version key mismatch. Aborting installation.`);
                }
                console.log(`Service Worker: Version key validated. Using cache name: ${CACHE_NAME}`);

                // 3. Open the cache and add all assets.
                const cache = await caches.open(CACHE_NAME);
                await cache.addAll(PRECACHE_ASSETS);

                console.log('Service Worker: App shell cached successfully.');
                return self.skipWaiting();
            })()
        );
    });

    self.addEventListener('activate', event => {
        event.waitUntil(
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        // Delete any cache that belongs to this app but is not the current one.
                        if (cacheName.startsWith(APP_PREFIX) && cacheName !== CACHE_NAME) {
                            console.log('Deleting old app cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }).then(() => self.clients.claim())
        );
    });

    self.addEventListener('fetch', event => {
        const url = new URL(event.request.url);

        // Don't cache 3d models or the PHP script.
        if (url.pathname.startsWith('/3d/') || url.pathname.endsWith('get_models.php')) {
            return;
        }

        // For navigation requests, use Cache-First strategy.
        if (event.request.mode === 'navigate') {
            event.respondWith((async () => {
                const cache = await caches.open(CACHE_NAME);
                const cachedResponse = await cache.match(event.request) || await cache.match('/');
                if (cachedResponse) {
                    return cachedResponse;
                }
                // If not in cache, this will fail while offline, which is expected for a first visit.
                return fetch(event.request);
            })());
            return;
        }

        // For all other requests (assets like JS, CSS), use a cache-first strategy.
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE_NAME);
                const cachedResponse = await cache.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                const networkResponse = await fetch(event.request);
                await cache.put(event.request, networkResponse.clone());
                return networkResponse;
            })()
        );
    });
}
