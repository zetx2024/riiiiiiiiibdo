const CACHE_NAME = 'iarco-secure-quiz-v18-offline-queue';
const API = 'https://i.eptonline.org/quij/quiz.php';
const QUEUE_DB='iarco_assessment_queue_v18';
const QUEUE_STORE='submissions';
const CORE = [
  './', './index.html', './styles.css', './app.js', './quiz.json', './users.json', './sw.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
];

function openQueue(){return new Promise((resolve,reject)=>{const r=indexedDB.open(QUEUE_DB,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(QUEUE_STORE)){const st=db.createObjectStore(QUEUE_STORE,{keyPath:'client_submission_id'});st.createIndex('created_at','created_at')}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);})}
async function allQueued(){const db=await openQueue();return new Promise((resolve,reject)=>{const tx=db.transaction(QUEUE_STORE,'readonly');const r=tx.objectStore(QUEUE_STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);})}
async function deleteQueued(id){const db=await openQueue();return new Promise((resolve,reject)=>{const tx=db.transaction(QUEUE_STORE,'readwrite');tx.objectStore(QUEUE_STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);})}
async function syncQueue(){
  let items=[];try{items=await allQueued()}catch{return;}
  for(const item of items){
    try{
      const res=await fetch(API+'?action=submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.payload)});
      const j=await res.json().catch(()=>null);
      if((res.ok&&j&&j.ok)||res.status===409||res.status===403){await deleteQueued(item.client_submission_id);}
    }catch(_){/* retain for the next background sync */}
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(CORE.map(async url => {
      try {
        const req = new Request(url, {mode: url.startsWith('http') ? 'cors' : 'same-origin'});
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    await syncQueue();
  })());
});

self.addEventListener('sync', event => {
  if(event.tag==='iarco-submit-queue') event.waitUntil(syncQueue());
});

self.addEventListener('message', event => {
  if(event.data?.type==='SYNC_SUBMISSIONS') event.waitUntil?.(syncQueue());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin && !url.hostname.includes('jsdelivr.net')) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) {
      fetch(event.request).then(res => { if (res.ok || res.type === 'opaque') caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone())); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(event.request);
      if (res.ok || res.type === 'opaque') caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
      return res;
    } catch (_) {
      return new Response('Resource unavailable while offline.', {status: 503, headers: {'Content-Type':'text/plain'}});
    }
  })());
});
