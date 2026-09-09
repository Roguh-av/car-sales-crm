const VERSION='crm-live-v13-priority-integrity';
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('crm-')).map(k=>caches.delete(k)));
    await self.clients.claim();
    // Do not navigate open windows: that discards unsaved call notes.
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }
  event.respondWith(fetch(req,{cache:'no-store'}));
});
