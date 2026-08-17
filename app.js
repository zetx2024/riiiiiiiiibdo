const API="https://i.eptonline.org/quij/quiz.php";
const CERT_API=API;
let user=null, quiz=null, attemptId=null, timer=null, startedAt=0, violations=0, submitting=false;

const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const safeEmail=()=>String(user?.email??"").trim().toLowerCase();
const key=()=>`iarco_quiz_state_${safeEmail()}`;
const read=()=>{try{return JSON.parse(localStorage.getItem(key())||"null")}catch{return null}};
const save=x=>localStorage.setItem(key(),JSON.stringify(x));

async function api(action,p={},timeoutMs=15000){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(`${API}?action=${encodeURIComponent(action)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p),signal:controller.signal});
    const j=await r.json().catch(()=>({ok:false,message:`Server returned ${r.status}`}));
    if(!r.ok||!j.ok) throw Error(j.message||`Server error (${r.status})`);
    return j;
  }catch(e){if(e?.name==='AbortError')throw Error('The assessment server is busy or the connection is taking too long. Your submission will be safely queued for retry.');throw e;}
  finally{clearTimeout(timeout);}
}


const QUEUE_DB='iarco_assessment_queue_v17';
const QUEUE_STORE='submissions';
function queueDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(QUEUE_DB,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(QUEUE_STORE)){const st=db.createObjectStore(QUEUE_STORE,{keyPath:'client_submission_id'});st.createIndex('created_at','created_at')}};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Offline queue unavailable'));})}
async function queuePut(payload){const db=await queueDb();return new Promise((resolve,reject)=>{const tx=db.transaction(QUEUE_STORE,'readwrite');tx.objectStore(QUEUE_STORE).put({...payload,created_at:payload.created_at||Date.now()});tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('Could not save offline submission'));})}
async function queueAll(){const db=await queueDb();return new Promise((resolve,reject)=>{const tx=db.transaction(QUEUE_STORE,'readonly');const r=tx.objectStore(QUEUE_STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);})}
async function queueDelete(id){const db=await queueDb();return new Promise((resolve,reject)=>{const tx=db.transaction(QUEUE_STORE,'readwrite');tx.objectStore(QUEUE_STORE).delete(id);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);})}
async function registerQueueSync(){try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.ready;if('sync' in reg)await reg.sync.register('iarco-submit-queue');}}catch(_){} }
async function syncQueuedSubmissions(){
  if(!navigator.onLine)return;
  let items=[];try{items=await queueAll()}catch{return}
  for(const item of items){
    try{
      const r=await api('submit',item.payload);
      await queueDelete(item.client_submission_id);
      // If the student is still on the result page, refresh its state. Certificate
      // generation is intentionally left to the foreground page because it needs
      // PDF assets/fonts and the student's certificate delivery flow.
      if(item.attempt_id===attemptId){
        save({status:r.status||'COMPLETED',attempt_id:item.attempt_id,score:r.score,total_questions:r.total_questions,percentile:r.percentile,submitted_at:r.submitted_at,time_taken:r.time_taken,duration_minutes:r.duration_minutes,email_status:'PENDING_CERTIFICATE',certificate_file:'',certificate_error:''});
        if(!submitting){submitting=true;await processCertificateAfterQueuedSubmit(r).catch(()=>{});}
      }
    }catch(e){
      // Keep it queued. A later online event/background sync retries it.
    }
  }
}
async function processCertificateAfterQueuedSubmit(r){
  const progress=showSubmissionProgress();await allowProgressPaint();
  progress.set(2,'Preparing your certificate','Your result is saved. We are now generating your certificate PDF.');
  const cert=await generateCertificatePdf(r.score,r.total_questions,r.percentile,r.time_taken,r.duration_minutes);
  progress.set(3,'Sending your certificate','Your certificate is ready. We are securely sending it to your registered email address.');await allowProgressPaint();
  const sent=await api('certificate_upload',{attempt_id:r.attempt_id,email:safeEmail(),certificate_pdf_base64:cert.base64});
  progress.set(4,'Submission complete','Your assessment has been fully processed.');progress.finish();await new Promise(r=>setTimeout(r,450));
  save({status:r.status||'COMPLETED',attempt_id:r.attempt_id,score:r.score,total_questions:r.total_questions,percentile:r.percentile,submitted_at:r.submitted_at,time_taken:r.time_taken,duration_minutes:r.duration_minutes,email_status:sent.email_status||'FAILED',certificate_file:sent.certificate_file||'',certificate_error:sent.email_error||''});
  submitting=false;home();
}
window.addEventListener('online',()=>{syncQueuedSubmissions();});
window.addEventListener('load',()=>{setTimeout(syncQueuedSubmissions,1200);});

function protect(){
  const b=e=>e.preventDefault();
  for(const n of ["contextmenu","copy","cut","dragstart","selectstart"]) document.addEventListener(n,b,{capture:true});
  document.addEventListener("keydown",e=>{
    const k=String(e.key??"").toLowerCase();
    const blocked=e.key==="F12"||((e.ctrlKey||e.metaKey)&&["a","c","u","s","p"].includes(k))||(e.ctrlKey&&e.shiftKey&&["i","j","c"].includes(k));
    if(blocked)e.preventDefault();
  },{capture:true});
}

function setPage(html,cls=""){
  document.body.className=cls;
  document.body.innerHTML=html;
}

async function environmentCheck(showOnlyIfNeeded=true){
  const ua=navigator.userAgent||'';
  const checks=[];
  const isModern=/Chrome\/\d+|Edg\/\d+|Firefox\/\d+|Safari\/\d+/.test(ua) && !/MSIE|Trident\//.test(ua);
  if(!isModern) checks.push({title:'Use a supported modern browser',detail:'Please use the latest Google Chrome, Microsoft Edge, Mozilla Firefox, or Safari.'});
  if(!window.fetch) checks.push({title:'Enable JavaScript / update your browser',detail:'The assessment requires Fetch API support.'});
  if(!window.localStorage) checks.push({title:'Enable site storage',detail:'Allow local storage/cookies for this assessment website.'});
  if(!window.crypto?.randomUUID) checks.push({title:'Update your browser',detail:'Secure session identification requires crypto.randomUUID().'});
  if(!document.fullscreenEnabled || !document.documentElement.requestFullscreen) checks.push({title:'Allow fullscreen mode',detail:'Use a desktop browser that supports fullscreen and allow fullscreen when the assessment starts.'});
  if(!window.Promise) checks.push({title:'Update your browser',detail:'Modern JavaScript Promise support is required.'});
  if(!showOnlyIfNeeded || checks.length){
    const old=document.querySelector('#environmentModal'); old?.remove();
    if(checks.length){
      const el=document.createElement('div');el.id='environmentModal';el.className='modal-backdrop';
      el.innerHTML=`<div class="modal-card environment-card" role="alertdialog" aria-modal="true"><div class="modal-top"><div class="modal-icon danger-icon">!</div><div><div class="eyebrow danger-text">BROWSER CHECK</div><h2>One setup step is required</h2></div></div><p class="muted">Your browser is close to ready, but the assessment cannot safely start until the following is fixed:</p><div class="environment-list">${checks.map(x=>`<div class="environment-item"><strong>${esc(x.title)}</strong><span>${esc(x.detail)}</span></div>`).join('')}</div><div class="modal-actions"><button id="recheckEnv" class="btn gold full">Check again</button></div></div>`;
      document.body.appendChild(el);el.querySelector('#recheckEnv').onclick=async()=>{el.remove();await environmentCheck(true);if(!document.querySelector('#environmentModal'))login()};
      return false;
    }
  }
  return true;
}

function login(){
  setPage(`<main class="auth-shell"><section class="auth-card">
    <div class="brand-mark">I</div><div class="eyebrow">SECURE ASSESSMENT PORTAL</div>
    <h1>IARCO Assessment</h1><p class="muted">Authorized participants only. Sign in to continue.</p>
    <div class="form-group"><label for="email">Email address</label><input id="email" class="field" type="email" autocomplete="username" placeholder="you@example.com"></div>
    <div class="form-group"><label for="password">Password</label><input id="password" class="field" type="password" autocomplete="current-password" placeholder="Enter your password"></div>
    <button id="login" class="btn gold full">Sign in securely</button><div id="msg" class="form-message"></div>
  </section></main>`);
  protect();
  const go=async()=>{
    const msg=document.querySelector("#msg");
    try{
      msg.textContent="Checking authorization…";msg.className="form-message loading";
      const list=await fetch("users.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("Could not load participant data");return r.json()});
      const email=String(document.querySelector("#email")?.value??"").trim().toLowerCase();
      const password=String(document.querySelector("#password")?.value??"");
      const x=Array.isArray(list)?list.find(v=>String(v?.email??"").trim().toLowerCase()===email&&String(v?.password??"")===password):null;
      if(!x) throw Error("Invalid email or password");
      user={...x,email};
      user.session_id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("iarco_quiz_user",JSON.stringify(user));
      await api("login",user);
      await home();
    }catch(e){msg.className="form-message error";msg.textContent=e.message||"Login failed";}
  };
  document.querySelector("#login").onclick=go;
  document.querySelectorAll("#email,#password").forEach(i=>i.addEventListener("keydown",e=>{if(e.key==="Enter")go()}));
}

async function downloadCertificate(attemptId){const b=document.getElementById("downloadCertificateBtn");if(!b)return;const old=b.textContent;b.disabled=true;b.textContent="Preparing download…";try{const r=await fetch(`${API}?action=certificate_download`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:safeEmail(),attempt_id:Number(attemptId)})});if(!r.ok)throw Error("Certificate download is not available yet.");const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.style.display="none";a.href=url;a.download="IARCO_Certificate.pdf";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(e){alert(e.message||"Could not download the certificate.");}finally{b.disabled=false;b.textContent=old;}}

async function home(){
  let s=read();
  try{
    const r=await api("status",{email:safeEmail()});
    if(r.exists){s={status:r.status,score:r.score,total_questions:r.total_questions,percentile:r.percentile,submitted_at:r.submitted_at,time_taken:r.time_taken,duration_minutes:r.duration_minutes,certificate_file:r.certificate_file,email_status:r.email_status};save(s)}
    else{s=null;localStorage.removeItem(key())}
  }catch(e){/* keep cached state if API temporarily unavailable */}

  const name=String(user?.name||safeEmail());
  const institution=String(user?.institution||user?.school||"");
  const program=String(user?.program||"IARCO Assessment");
  setPage(`<main class="portal-shell"><section class="student-card">
    <div class="student-head"><div><div class="eyebrow">IARCO SECURE ASSESSMENT</div><h1>Welcome, ${esc(name)}</h1><p class="muted">${esc(institution)}</p></div><div class="participant-chip">${esc(String(user?.participant_id||user?.id||"Participant"))}</div></div>
    <div id="content"></div>
  </section></main>`);
  const c=document.querySelector("#content");
  if(!c)return;
  if(s?.status==="COMPLETED"){
    c.innerHTML=`<div class="result-hero"><div class="result-icon">✓</div><div><div class="eyebrow">ASSESSMENT COMPLETED</div><h2>Thank you for participating</h2><p>Your result has been securely recorded.</p></div></div>
      <div class="stats-grid"><div class="stat"><span>Score</span><b>${esc(s.score)}/${esc(s.total_questions)}</b></div><div class="stat"><span>Time taken</span><b>${formatSeconds(s.time_taken)}</b></div><div class="stat"><span>Total duration</span><b>${esc(s.duration_minutes)} min</b></div></div>
      <div class="certificate-status ${s.email_status==='SENT'?'good':'warn'}"><strong>Certificate delivery:</strong> ${esc(s.email_status||"PENDING")}<br><span>${esc(s.certificate_file||"Certificate processing is in progress.")}</span>${s.certificate_file?`<br><button type="button" id="downloadCertificateBtn" class="btn gold" style="margin-top:12px">Download Certificate</button>`:''}</div>
      <p class="muted center-note">Another attempt is available only after an administrator deletes this submission.</p>`;
  if(s?.status==="COMPLETED" && s?.certificate_file){
    const btn=document.querySelector('#downloadCertificateBtn');
    if(btn) btn.onclick=()=>downloadCertificate(s.attempt_id);
  }
    }else if(s?.status==="CHEATED"){
    c.innerHTML=`<div class="status-panel danger-panel"><strong>Attempt closed</strong><p>${esc(name)}, a quiz security violation was recorded. Please contact the administrator.</p></div>`;
  }else if(s?.status==="STARTED"){
    c.innerHTML=`<div class="status-panel warning-panel"><strong>Attempt already registered</strong><p>An assessment attempt is already active or was not completed. Contact the administrator if you need assistance.</p></div>`;
  }else{
    c.innerHTML=`<div class="assessment-intro"><div class="intro-icon">Q</div><div><h2>Ready for your assessment?</h2><p>Questions and answer options are randomized for each attempt.</p></div></div>
      <div class="info-grid"><div><span>Participant</span><b>${esc(name)}</b></div><div><span>Program</span><b>${esc(program)}</b></div><div><span>Category</span><b>${esc(user?.category||user?.role||"Participant")}</b></div><div><span>Year</span><b>${esc(user?.years||new Date().getFullYear())}</b></div></div>
      <button id="start" class="btn gold full start-btn">Start Assessment <span>→</span></button>`;
    document.querySelector("#start").onclick=async()=>{try{await loadQuiz();instructions()}catch(e){alert(e.message)}};
  }
}

async function loadQuiz(){
  // The server exposes the single configured quiz source from quij/config.php.
  // This keeps frontend, scoring and admin dashboard synchronized when the JSON URL changes.
  const r=await api("quiz_config");
  const q=r.config;
  if(!Array.isArray(q?.variants)||!q.variants.length)throw Error("No quiz variants found in the configured quiz JSON");
  const valid=q.variants.filter(v=>v&&v.id&&Array.isArray(v.questions)&&v.questions.length);
  if(!valid.length)throw Error("Quiz variants are configured incorrectly.");
  quiz={source:{...q,variants:valid},time_limit_minutes:Number(q.time_limit_minutes)||15,source_url:r.source_url||""};
}

function instructions(){
  const variants=quiz.source.variants;
  const total=variants.reduce((n,v)=>n+v.questions.length,0);
  const el=document.createElement("div");el.id="modal";el.className="modal-backdrop";
  el.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="quizInstructions">
    <div class="modal-top"><div class="modal-icon">✓</div><div><div class="eyebrow">BEFORE YOU BEGIN</div><h2 id="quizInstructions">Assessment instructions</h2></div></div>
    <div class="modal-summary"><div><span>Question pool</span><strong>${total}</strong></div><div><span>Questions per variant</span><strong>${variants[0].questions.length}</strong></div><div><span>Time limit</span><strong>${esc(quiz.time_limit_minutes)} min</strong></div></div>
    <div class="rules"><h3>Important rules</h3><ul><li>Only one attempt is permitted unless an administrator deletes the existing attempt.</li><li>Do not switch tabs, windows, or leave the assessment page.</li><li>Copying, right-clicking and common developer shortcuts are blocked.</li><li>Security/focus violations are recorded in the assessment database.</li><li>The assessment submits automatically when the countdown reaches zero.</li></ul></div>
    <div class="modal-actions"><button id="cancel" class="btn secondary">Cancel</button><button id="attempt" class="btn gold">Attempt Quiz <span>→</span></button></div>
  </div>`;
  document.body.appendChild(el);
  el.querySelector("#cancel").onclick=()=>el.remove();
  el.querySelector("#attempt").onclick=start;
  requestAnimationFrame(()=>el.querySelector("#attempt")?.focus());
}

async function start(){
  try{
    if(!(await environmentCheck(true))) return;
    try{await document.documentElement.requestFullscreen?.();}catch(_){}
    const variants=quiz.source.variants;
    const v=variants[Math.floor(Math.random()*variants.length)];
    if(!v?.id||!Array.isArray(v.questions))throw Error("Selected quiz variant is invalid.");
    quiz={time_limit_minutes:Number(v.time_limit_minutes||quiz.source.time_limit_minutes||15),variant_id:String(v.id).toUpperCase(),questions:[...v.questions].sort(()=>Math.random()-.5).map(x=>({...x,options:Array.isArray(x.options)?[...x.options].sort(()=>Math.random()-.5):x.options}))};
    const r=await api("start",{email:safeEmail(),name:user.name||"",institution:user.institution||user.school||"",country:user.country||"",category:user.category||user.role||"",variant_id:quiz.variant_id,participant_id:user.participant_id||user.id||"",program:user.program||"",batch:user.batch||"",image:user.image||"",role:user.role||"",participation_date:user.date||"",years:user.years||"",session_id:user.session_id||""});
    attemptId=r.attempt_id;startedAt=Date.now();save({status:"STARTED",attempt_id:attemptId,variant_id:quiz.variant_id,duration_minutes:quiz.time_limit_minutes});
    document.querySelector("#modal")?.remove();render();guards();startTimer();
  }catch(e){alert(e.message||"Could not start the assessment.")}
}

function render(){
  document.body.className="quiz-active";
  document.body.innerHTML=`<div class="quiz-app">
    <header class="quiz-nav"><div class="quiz-nav-inner"><div class="quiz-brand"><span class="brand-mark small-mark">I</span><span>IARCO Assessment</span></div><div class="quiz-status-center"><div class="status-kicker">ASSESSMENT PROGRESS</div><div class="status-main"><span id="progressText">0 of ${quiz.questions.length} answered</span><span class="status-divider">•</span><span>${esc(quiz.time_limit_minutes)} min</span></div></div><div class="timer" id="timerBox"><span class="timer-label">TIME LEFT</span><strong id="time">--:--</strong></div></div><div class="assessment-progress"><div class="assessment-progress-row"><span>Progress</span><span id="progressPercent">0%</span></div><div class="progress-track"><div id="progressBar" class="progress-bar" style="width:0%"></div></div></div></header>
    <main class="quiz-main"><section class="quiz-intro-card"><div><div class="eyebrow">SECURE ASSESSMENT</div><h1>Answer each question carefully</h1><p>Questions and options have been randomized for this attempt.</p></div><div class="question-count">${quiz.questions.length} Questions</div></section>
    <form id="form">${quiz.questions.map((q,i)=>`<section class="question-card" id="question_${esc(q.id)}"><div class="question-top"><span class="question-index">${String(i+1).padStart(2,"0")}</span><span class="question-type">${q.type==='single'?'Single choice':q.type==='multi'?'Multiple choice':'Short answer'}</span></div><h2>${esc(q.question)}</h2><div class="answer-list">${q.type==="single"?q.options.map((o,j)=>`<label class="option"><input type="radio" name="q_${esc(q.id)}" value="${esc(o)}"><span class="option-key">${String.fromCharCode(65+j)}</span><span>${esc(o)}</span></label>`).join(""):q.type==="multi"?q.options.map((o,j)=>`<label class="option"><input type="checkbox" name="q_${esc(q.id)}" value="${esc(o)}"><span class="option-key">${String.fromCharCode(65+j)}</span><span>${esc(o)}</span></label>`).join(""):`<textarea class="answer-text" name="q_${esc(q.id)}" maxlength="500" placeholder="Type your answer here..."></textarea>`}</div></section>`).join("")}<div class="submit-bar"><div><strong>Ready to submit?</strong><span>Review your answers before finishing.</span></div><button type="submit" class="btn gold">Submit Assessment <span>→</span></button></div></form></main></div>`;
  const form=document.querySelector("#form");
  form.onsubmit=e=>{e.preventDefault();if(confirm("Submit your assessment now?"))submit("MANUAL")};
  form.addEventListener("change",updateProgress);form.addEventListener("input",updateProgress);updateProgress();
}

function updateProgress(){
  if(!quiz)return;let answered=0;
  for(const q of quiz.questions){const els=[...document.querySelectorAll(`[name="q_${CSS.escape(q.id)}"]`)];if(q.type==="multi"?els.some(x=>x.checked):q.type==="text"?String(els[0]?.value??"").trim().length>0:els.some(x=>x.checked))answered++;}
  const pct=Math.round(answered/quiz.questions.length*100);const t=document.querySelector("#progressText"),p=document.querySelector("#progressPercent"),b=document.querySelector("#progressBar");if(t)t.textContent=`${answered} of ${quiz.questions.length} answered`;if(p)p.textContent=`${pct}%`;if(b)b.style.width=`${pct}%`;
}

function answers(){
  const o={};for(const q of quiz.questions){const a=[...document.querySelectorAll(`[name="q_${CSS.escape(q.id)}"]`)];o[q.id]=q.type==="multi"?a.filter(x=>x.checked).map(x=>x.value):q.type==="text"?(a[0]?.value??""):(a.find(x=>x.checked)?.value??"");}return o;
}
function formatSeconds(sec){sec=Math.max(0,Number(sec)||0);return `${Math.floor(sec/60)} min ${String(sec%60).padStart(2,"0")} sec`}
function startTimer(){let s=(quiz.time_limit_minutes||15)*60;const tick=()=>{const e=document.querySelector("#time"),box=document.querySelector("#timerBox");if(!e)return;e.textContent=`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;if(box)box.classList.toggle("critical",s<=15);if(s<=0){clearInterval(timer);submit("TIMEOUT");return}s--};tick();timer=setInterval(tick,1000)}

let guardsArmed=false;
function guards(){
  const b=e=>e.preventDefault();
  for(const n of ["contextmenu","copy","cut","selectstart","dragstart"])document.addEventListener(n,b,{capture:true});

  // Do NOT use window.blur as a cheating signal. Browsers fire blur for ordinary clicks,
  // fullscreen transitions, permission prompts and other harmless focus changes.
  // A tab switch is recorded only when the page actually becomes hidden.
  document.addEventListener("visibilitychange",()=>{
    if(!guardsArmed || submitting) return;
    if(document.visibilityState==="hidden") violate("TAB_SWITCH","document.visibilityState=hidden");
  },{capture:true});

  window.addEventListener("beforeunload",e=>{
    if(!submitting && guardsArmed){e.preventDefault();e.returnValue="";}
  });

  document.addEventListener("keydown",e=>{
    if(!guardsArmed || submitting) return;
    const k=String(e.key??"").toLowerCase();
    const blocked=e.key==="F12"||((e.ctrlKey||e.metaKey)&&["a","c","u","s","p"].includes(k))||(e.ctrlKey&&e.shiftKey&&["i","j","c"].includes(k));
    if(blocked){
      e.preventDefault();
      e.stopPropagation();
      violate("BLOCKED_SHORTCUT",`key=${e.key};ctrl=${e.ctrlKey};shift=${e.shiftKey};alt=${e.altKey}`);
    }
  },{capture:true});

  // Fullscreen is only a usability/security request. Leaving fullscreen is NOT a violation.
  // No window.blur/focus handler is installed: ordinary clicks and fullscreen transitions are never violations.
  // Browser pages cannot reliably detect or stop external OS-level capture by Zoom/Meet. The server also
  // sends Permissions-Policy: display-capture=() so this assessment origin cannot initiate browser screen capture.
  try{document.documentElement.requestFullscreen?.().catch(()=>{});}catch(_){}
  setTimeout(()=>{guardsArmed=true;},1200);
}

function cheatingModal(reason){
  document.querySelector("#cheatModal")?.remove();
  const el=document.createElement("div");el.id="cheatModal";el.className="modal-backdrop cheat-backdrop";
  el.innerHTML=`<div class="modal-card cheat-card" role="alertdialog" aria-modal="true" aria-labelledby="cheatTitle">
    <div class="modal-top"><div class="modal-icon danger-icon">!</div><div><div class="eyebrow danger-text">SECURITY VIOLATION</div><h2 id="cheatTitle">Assessment security violation detected</h2></div></div>
    <p class="cheat-message">${esc(user?.name||safeEmail())}, this event has already been recorded in the assessment database. This dialog cannot be cancelled or dismissed.</p>
    <div class="violation-reason"><span>Recorded activity</span><strong>${esc(reason)}</strong></div>
    <div class="modal-actions"><button id="endCheat" class="btn danger-btn full">End this assessment</button></div>
  </div>`;
  document.body.appendChild(el);
  el.querySelector("#endCheat").onclick=()=>{
    submitting=true;clearInterval(timer);
    try{document.exitFullscreen?.().catch(()=>{});}catch(_){}
    save({status:"CHEATED",attempt_id:attemptId,reason});
    setPage(`<main class="portal-shell"><section class="student-card"><div class="status-panel danger-panel"><strong>Assessment ended</strong><p>Your security violation was recorded automatically. Please contact the administrator if you believe this was an error.</p></div></section></main>`);
  };
  requestAnimationFrame(()=>el.querySelector("#endCheat")?.focus());
}

async function violate(reason,details=""){
  if(submitting)return;
  submitting=true;
  clearInterval(timer);
  let recorded=false;
  try{
    const r=await api("violation",{attempt_id:attemptId,email:safeEmail(),reason,details});
    recorded=!!r.recorded;
  }catch(e){
    try{
      const payload=JSON.stringify({attempt_id:attemptId,email:safeEmail(),reason,details});
      navigator.sendBeacon(`${API}?action=violation`,new Blob([payload],{type:"application/json"}));
    }catch(_){}
  }
  cheatingModal(recorded?reason:`${reason} (server acknowledgement pending)`);
}
async function getAsset(year,asset){const r=await fetch(`${CERT_API}?action=certificate_asset&year=${encodeURIComponent(year)}&asset=${encodeURIComponent(asset)}`);if(!r.ok)throw Error(`Certificate asset unavailable (${asset}, HTTP ${r.status})`);return await r.arrayBuffer()}

function ensureQrContainer(){let q=document.getElementById("qrcode");if(!q){q=document.createElement("div");q.id="qrcode";q.setAttribute("aria-hidden","true");q.style.cssText="position:fixed;left:-10000px;top:-10000px;width:100px;height:100px;overflow:hidden;";document.body.appendChild(q)}return q}
function qrDataUrl(text){return new Promise((resolve,reject)=>{const q=ensureQrContainer();q.innerHTML="";try{if(typeof QRCode!=="function")throw Error("QR code library did not load");new QRCode(q,{text,width:90,height:90,correctLevel:QRCode.CorrectLevel.L});setTimeout(()=>{const c=q.querySelector("canvas"),img=q.querySelector("img");if(c)return resolve(c.toDataURL("image/png"));if(img)return resolve(img.src);reject(Error("QR generation failed"))},300)}catch(e){reject(e)}})}
function bytesToBase64(bytes){let binary="";const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));return btoa(binary)}

async function generateCertificatePdf(score,total,percentile,timeTaken,duration){
  if(!window.PDFLib)throw Error("PDF library did not load. Check the CDN connection.");
  const year=String(user?.years||new Date().getFullYear());
  const info=await api("certificate_info",{year});
  if(!info?.url)throw Error(`No certificate template is configured for ${year}.`);
  const bytes=await getAsset(year,"template");
  const pdf=await PDFLib.PDFDocument.load(bytes);
  const page=pdf.getPages()[0];
  const studentId=String(user?.participant_id||user?.id||"");
  const name=String(user?.name||"");const school=String(user?.school||user?.institution||"");const role=String(user?.role||user?.category||"");const date=String(user?.date||"");
  let GreatVibes=null,PtSans=null;
  if(window.fontkit){
    try{pdf.registerFontkit(window.fontkit);const [font1,font2]=await Promise.all([getAsset(year,"greatvibes"),getAsset(year,"ptsans")]);GreatVibes=await pdf.embedFont(font1);PtSans=await pdf.embedFont(font2)}catch(e){console.warn("Custom fonts unavailable; using fallback fonts.",e)}
  }
  const normal=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);const italic=await pdf.embedFont(PDFLib.StandardFonts.HelveticaOblique);
  const nf=GreatVibes||italic,pf=PtSans||normal;
  const fsN=GreatVibes?35:24,fsP=15;const textWidthN=nf.widthOfTextAtSize(name,fsN);page.drawText(name,{x:page.getWidth()/2-textWidthN/2,y:page.getHeight()/1.57,size:fsN,font:nf});
  const textWidthS=pf.widthOfTextAtSize(school,fsP);page.drawText(school,{x:page.getWidth()/2-textWidthS/2,y:page.getHeight()/1.9,size:fsP,font:pf});
  page.drawText(studentId,{x:700,y:500,size:9,font:normal});page.drawText(role+" Category",{x:490,y:283,size:14,font:normal});page.drawText(date,{x:530,y:260,size:14,font:normal});
  // Keep the QR payload deliberately short. qrcodejs has a finite capacity and the
  // previous certificate embedded too much student/result text, causing
  // "code length overflow" for longer records. The certificate itself contains
  // the complete result; the QR only needs the participant identifier.
  const qr=await qrDataUrl(`IARCO|ID:${studentId}`);
  const qrBytes=await fetch(qr).then(r=>r.arrayBuffer());const qrImg=await pdf.embedPng(qrBytes);page.drawImage(qrImg,{x:700,y:400,width:90,height:90});
  const CERT_METADATA={
    titlePrefix:"IARCO Assessment Certificate",
    author:"IARCO",
    subject:"IARCO Assessment Certificate",
    creator:"IARCO Secure Assessment Portal",
    producer:"Sanaul Haque IARCO Host",
    producedDate:"2026-08-20T00:00:00+06:00"
  };
  const producedAt=new Date(CERT_METADATA.producedDate);
  const metadata={
    title:`${CERT_METADATA.titlePrefix} - ${name}`,
    author:CERT_METADATA.author,
    subject:CERT_METADATA.subject,
    keywords:[studentId,String(user?.program||""),String(user?.batch||""),String(user?.role||user?.category||""),year].filter(Boolean),
    creator:CERT_METADATA.creator,
    producer:CERT_METADATA.producer,
    creationDate:producedAt,
    modificationDate:producedAt
  };
  pdf.setTitle(metadata.title);pdf.setAuthor(metadata.author);pdf.setSubject(metadata.subject);pdf.setKeywords(metadata.keywords);pdf.setCreator(metadata.creator);pdf.setProducer(metadata.producer);pdf.setCreationDate(metadata.creationDate);pdf.setModificationDate(metadata.modificationDate);
  return {base64:bytesToBase64(await pdf.save())};
}


function showSubmissionProgress(){
  document.querySelector('#submissionProgress')?.remove();
  const el=document.createElement('div');el.id='submissionProgress';el.className='modal-backdrop submission-progress-backdrop';
  el.innerHTML=`<div class="modal-card submission-progress-card" role="status" aria-live="polite" aria-busy="true">
    <div class="submission-progress-icon"><span class="submission-spinner"></span></div>
    <div class="eyebrow">SECURE SUBMISSION</div>
    <h2 id="submitProgressTitle">Saving your assessment</h2>
    <p id="submitProgressMessage" class="muted">Please keep this page open while we securely save your answers.</p>
    <div class="submission-progress-track"><div id="submitProgressBar" class="submission-progress-fill" style="width:12%"></div></div>
    <div class="submission-progress-steps"><span id="submitStep1" class="active">1. Save answers</span><span id="submitStep2">2. Prepare certificate</span><span id="submitStep3">3. Send certificate</span></div>
    <p class="submission-progress-note">Do not close or refresh this page until processing is complete.</p>
  </div>`;
  document.body.appendChild(el);
  return {
    set(step,title,message){
      const widths={1:18,2:52,3:82,4:100};
      const bar=document.querySelector('#submitProgressBar');if(bar)bar.style.width=(widths[step]||18)+'%';
      const t=document.querySelector('#submitProgressTitle'),m=document.querySelector('#submitProgressMessage');if(t)t.textContent=title;if(m)m.textContent=message;
      [1,2,3].forEach(n=>{const x=document.querySelector(`#submitStep${n}`);if(x)x.classList.toggle('active',n<=step)});
    },
    finish(){const bar=document.querySelector('#submitProgressBar');if(bar)bar.style.width='100%';const icon=document.querySelector('.submission-progress-icon');if(icon)icon.innerHTML='<span class="submission-success">✓</span>';}
  };
}
async function allowProgressPaint(){await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}

async function submit(reason){
  if(submitting)return;submitting=true;clearInterval(timer);const timeTaken=Math.max(0,Math.round((Date.now()-startedAt)/1000));
  const progress=showSubmissionProgress();
  try{
    await allowProgressPaint();
    progress.set(1,'Saving your assessment','Your answers are being securely recorded in the assessment database.');
    const clientSubmissionId=`${attemptId}-${safeEmail()}-${startedAt}`;
    const payload={attempt_id:attemptId,email:safeEmail(),answers:answers(),time_taken:timeTaken,reason,variant_id:quiz.variant_id,client_submission_id:clientSubmissionId};
    let r;
    try{r=await api('submit',payload);}catch(networkErr){
      try{await queuePut({client_submission_id:clientSubmissionId,attempt_id:attemptId,payload});await registerQueueSync();
        progress.set(4,'Submission queued securely','Your answers are saved on this device and will be sent automatically to the assessment server when the connection is available.');progress.finish();
        setTimeout(()=>{setPage(`<main class="portal-shell"><section class="student-card completion-card"><div class="result-hero"><div class="result-icon">✓</div><div><div class="eyebrow">SUBMISSION QUEUED</div><h1>Your assessment is safely queued</h1><p>Your answers are stored locally and will be sent automatically when the connection to the assessment server is restored.</p></div></div><div class="certificate-status warn"><strong>Certificate: PENDING SERVER SYNC</strong><br><span>Keep this browser/device available and connected. The certificate will be processed after the server receives your submission.</span></div></section></main>`);submitting=false;},500);return;
      }catch(queueErr){throw networkErr;}
    }
    let emailStatus='PENDING_CERTIFICATE',certificateFile='',certificateError='';
    if(reason!=='CHEATING'){
      try{
        progress.set(2,'Preparing your certificate','Your result is saved. We are now generating your certificate PDF.');
        await allowProgressPaint();
        const cert=await generateCertificatePdf(r.score,r.total_questions,r.percentile,r.time_taken,r.duration_minutes);
        progress.set(3,'Sending your certificate','Your certificate is ready. We are securely sending it to your registered email address.');
        await allowProgressPaint();
        const sent=await api('certificate_upload',{attempt_id:attemptId,email:safeEmail(),certificate_pdf_base64:cert.base64});emailStatus=sent.email_status||'FAILED';certificateFile=sent.certificate_file||'';certificateError=sent.email_error||'';
      }catch(certErr){emailStatus='FAILED';certificateError=certErr.message||'Unknown certificate error';}
    }
    progress.set(4,'Submission complete','Your assessment has been fully processed.');progress.finish();await new Promise(r=>setTimeout(r,450));
    const s={status:r.status||'COMPLETED',attempt_id:attemptId,score:r.score,total_questions:r.total_questions,percentile:r.percentile,submitted_at:r.submitted_at,time_taken:r.time_taken,duration_minutes:r.duration_minutes,email_status:emailStatus,certificate_file:certificateFile,certificate_error:certificateError};save(s);
    setPage(`<main class="portal-shell"><section class="student-card completion-card"><div class="result-hero"><div class="result-icon">✓</div><div><div class="eyebrow">SUBMISSION RECEIVED</div><h1>Assessment saved successfully</h1><p>Your answers and result are recorded in the assessment system.</p></div></div><div class="stats-grid"><div class="stat"><span>Score</span><b>${esc(r.score)}/${esc(r.total_questions)}</b></div><div class="stat"><span>Time taken</span><b>${formatSeconds(r.time_taken)}</b></div><div class="stat"><span>Duration</span><b>${esc(r.duration_minutes)} min</b></div></div><div class="certificate-status ${emailStatus==='SENT'?'good':'warn'}"><strong>Certificate: ${esc(emailStatus)}</strong>${certificateFile?`<br><button type="button" id="downloadCertificateBtn" class="btn gold" style="margin-top:12px">Download Certificate</button>`:''}${certificateError?`<br><span>${esc(certificateError)}</span>`:''}${emailStatus!=='SENT'?`<br><span>The assessment itself is saved. The administrator can inspect the error and resend when the certificate file is available.</span>`:''}</div></section></main>`);
  }catch(e){document.querySelector('#submissionProgress')?.remove();submitting=false;alert(e.message||'Submission failed');startTimer();}
}

try{user=JSON.parse(localStorage.getItem("iarco_quiz_user")||"null")}catch{user=null}
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').then(()=>syncQueuedSubmissions()).catch(()=>{});}
(async()=>{const ok=await environmentCheck(true);if(ok){user&&safeEmail()?home():login();}})();
