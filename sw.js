const VERSION='crm-live-v2';
self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.clients.claim();
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){try{await client.navigate(client.url)}catch(e){}}
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      const res=await fetch(req,{cache:'no-store'});
      const type=res.headers.get('content-type')||'';
      if(!type.includes('text/html'))return res;
      let html=await res.text();
      if(!html.includes('/crm-ui-patch.js')){
        html=html.replace('</body>','<script src="/crm-ui-patch.js?v=2"></script></body>');
      }
      const headers=new Headers(res.headers);
      headers.delete('content-length');
      headers.set('cache-control','no-store');
      return new Response(html,{status:res.status,statusText:res.statusText,headers});
    })());
    return;
  }
  event.respondWith(fetch(req,{cache:'no-store'}));
});
