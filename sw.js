const DEV_HOST_REGEX = /localhost|127\.0\.0\.1|dbfm\.derben\.ca/;
const PROD_HOST = 'derben.ca';
const CACHE_PREFIX = 'archery-cache-';

let currentCacheName;

const ASSETS = [
    './',
    './game.html',
    './main.js',
    './manifest.json',
    './js/rapier/rapier.mjs',
    './js/rapier/rapier_wasm3d.js',
    './js/rapier/rapier_wasm3d_bg.wasm',
    './js/three/build/three.module.js',
    './js/three/examples/jsm/webxr/ARButton.js',
    './js/three/examples/jsm/loaders/GLTFLoader.js',
    './js/three/examples/jsm/webxr/XRControllerModelFactory.js',
    './js/three/examples/jsm/webxr/XRPlanes.js',
    './3d/bowling.glb',
    './3d/bone.glb',
    './3d/skull.glb',
    './3d/blood.png'
    
];

const sendMessage = async (message) => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(client => client.postMessage(message));
};

self.addEventListener('install', (event) => {
    if (DEV_HOST_REGEX.test(self.location.hostname)) {
        console.log('Bypassing service worker install for development.');
        event.waitUntil(
            sendMessage({ type: 'complete' }).then(() => self.skipWaiting())
        );
        return;
    }
    event.waitUntil(
        (async () => {
            try {
                const response = await fetch('./version.json');
                const { version } = await response.json();
                currentCacheName = `${CACHE_PREFIX}v${version}`;
                const cache = await caches.open(currentCacheName);
                const total = ASSETS.length;

                for (let i = 0; i < total; i++) {
                    const asset = ASSETS[i];
                    try {
                        // Always fetch from network and cache, to ensure we have the latest version of assets for this version
                        const req = new Request(asset, { cache: 'reload' });
                        await cache.add(req);
                        await sendMessage({ type: 'progress', loaded: i + 1, total, file: asset });
                    } catch (err) {
                        console.error(`Failed to cache ${asset}:`, err);
                        await sendMessage({ type: 'error', message: `Failed to download: ${asset}` });
                        throw err;
                    }
                }
                await sendMessage({ type: 'complete' });

                // Clean up old caches
                const cacheNames = await caches.keys();
                const oldCacheNames = cacheNames.filter(name => name.startsWith(CACHE_PREFIX) && name !== currentCacheName);
                await Promise.all(oldCacheNames.map(name => caches.delete(name)));

                self.skipWaiting();
            } catch (err) {
                console.error('Service worker installation failed.', err);
            }
        })()
    );
});

self.addEventListener('activate', (event) => {
                                              
                                                                            
                                    
     
                    
                      
                 
    event.waitUntil(self.clients.claim());
                                                               
                                                          
                                                                

                                                       
                                                                                                                            
                                                                                  
                           
                                                                        
             
            
      
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    if (DEV_HOST_REGEX.test(requestUrl.hostname)) {
        return event.respondWith(fetch(event.request));
    }

    event.respondWith(
        (async () => {
            const cachedResponse = await caches.match(event.request);
            if (cachedResponse) return cachedResponse;

            try {
                const networkResponse = await fetch(event.request);
                if (currentCacheName && event.request.method === 'GET') {
                    const cache = await caches.open(currentCacheName);
                    cache.put(event.request, networkResponse.clone());
                }
                return networkResponse;
            } catch (error) {
                console.error('Fetch failed:', error);
            }
        })()
    );
});