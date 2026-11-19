const assets = /* BUILD_FILES */ [];
const prefix = 'kol-room-drummer-' + new URL(self.registration.scope).pathname + '-';
const cacheName = prefix + 'BUILD_VERSION';
const absolute = path => new URL(path,self.registration.scope).href;
const shell = absolute('index.html');
const known = new Set(assets.map(absolute));
const voiceFiles = new Set([...known].filter(url=>url.startsWith(absolute('voice/'))));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll([...known].filter(url=>!voiceFiles.has(url)))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(prefix) && key!==cacheName).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET') return;
  const navigation=event.request.mode==='navigate';
  if(!known.has(event.request.url) && !navigation)return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    // Only build-listed, same-origin static files enter this cache. A module
    // request can carry a different Origin header than the installation fetch.
    const hit=await cache.match(navigation?shell:event.request.url,{ignoreVary:true});
    if(hit)return hit;
    const response=await fetch(event.request);
    if(voiceFiles.has(event.request.url) && response.ok) await cache.put(event.request.url,response.clone());
    return response;
  })());
});
