const API="https://i.eptonline.org/quij/quiz.php";
const CERT_API=API;
let user=null, quiz=null, attemptId=null, timer=null, startedAt=0, violations=0, submitting=false;

const esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const safeEmail=()=>String(user?.email??"").trim().toLowerCase();
const key=()=>`iarco_quiz_state_${safeEmail()}`;
const read=()=>{try{return JSON.parse(localStorage.getItem(key())||"null")}catch{return null}};
const save=x=>localStorage.setItem(key(),JSON.stringify(x));

async function api(action,p={}){
  const r=await fetch(`${API}?action=${encodeURIComponent(action)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});
  const j=await r.json().catch(()=>({ok:false,message:`Server returned ${r.status}`}));
  if(!r.ok||!j.ok) throw Error(j.message||`Server error (${r.status})`);
  return j;
}

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
      <div class="certificate-status ${s.email_status==='SENT'?'good':'warn'}"><strong>Certificate delivery:</strong> ${esc(s.email_status||"PENDING")}<br><span>${esc(s.certificate_file||"Certificate processing is in progress.")}</span></div>
      <p class="muted center-note">Another attempt is available only after an administrator deletes this submission.</p>`;
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

function guards(){
  const b=e=>e.preventDefault();
  for(const n of ["contextmenu","copy","cut","selectstart","dragstart"])document.addEventListener(n,b,{capture:true});
  // Page Visibility is the exact signal for a tab switch.
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden"&&!submitting) violate("TAB_SWITCH","document.visibilityState=hidden");
  },{capture:true});
  // Window blur is kept separate for focus loss while the document is still visible.
  window.addEventListener("blur",()=>{
    if(!submitting && document.visibilityState==="visible") violate("WINDOW_BLUR","window.blur while document remained visible");
  },{capture:true});
  window.addEventListener("beforeunload",e=>{if(!submitting){e.preventDefault();e.returnValue="";}});
  document.addEventListener("keydown",e=>{
    const k=String(e.key??"").toLowerCase();
    const blocked=e.key==="F12"||((e.ctrlKey||e.metaKey)&&["a","c","u","s","p"].includes(k))||(e.ctrlKey&&e.shiftKey&&["i","j","c"].includes(k));
    if(blocked){e.preventDefault();if(!submitting)violate("BLOCKED_SHORTCUT",`key=${e.key};ctrl=${e.ctrlKey};shift=${e.shiftKey};alt=${e.altKey}`);}
  },{capture:true});
  try{document.documentElement.requestFullscreen?.().catch(()=>{});}catch(_){}
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
async function submit(reason){
  if(submitting)return;submitting=true;clearInterval(timer);const timeTaken=Math.max(0,Math.round((Date.now()-startedAt)/1000));
  try{
    const r=await api("submit",{attempt_id:attemptId,email:safeEmail(),answers:answers(),time_taken:timeTaken,reason,variant_id:quiz.variant_id});
    let emailStatus="PENDING_CERTIFICATE",certificateFile="",certificateError="";
    if(reason!=="CHEATING"){
      try{const cert=await generateCertificatePdf(r.score,r.total_questions,r.percentile,r.time_taken,r.duration_minutes);const sent=await api("certificate_upload",{attempt_id:attemptId,email:safeEmail(),certificate_pdf_base64:cert.base64});emailStatus=sent.email_status||"FAILED";certificateFile=sent.certificate_file||"";certificateError=sent.email_error||"";}
      catch(certErr){emailStatus="FAILED";certificateError=certErr.message||"Unknown certificate error";}
    }
    const s={status:r.status||"COMPLETED",attempt_id:attemptId,score:r.score,total_questions:r.total_questions,percentile:r.percentile,submitted_at:r.submitted_at,time_taken:r.time_taken,duration_minutes:r.duration_minutes,email_status:emailStatus,certificate_file:certificateFile,certificate_error:certificateError};save(s);
    setPage(`<main class="portal-shell"><section class="student-card completion-card"><div class="result-hero"><div class="result-icon">✓</div><div><div class="eyebrow">SUBMISSION RECEIVED</div><h1>Assessment saved successfully</h1><p>Your answers and result are recorded in the assessment system.</p></div></div><div class="stats-grid"><div class="stat"><span>Score</span><b>${esc(r.score)}/${esc(r.total_questions)}</b></div><div class="stat"><span>Time taken</span><b>${formatSeconds(r.time_taken)}</b></div><div class="stat"><span>Duration</span><b>${esc(r.duration_minutes)} min</b></div></div><div class="certificate-status ${emailStatus==='SENT'?'good':'warn'}"><strong>Certificate: ${esc(emailStatus)}</strong>${certificateFile?`<br><span>${esc(certificateFile)}</span>`:""}${certificateError?`<br><span>${esc(certificateError)}</span>`:""}${emailStatus!=='SENT'?`<br><span>The assessment itself is saved. The administrator can inspect the error and resend when the certificate file is available.</span>`:""}</div></section></main>`);
  }catch(e){submitting=false;alert(e.message||"Submission failed");startTimer()}
}

try{user=JSON.parse(localStorage.getItem("iarco_quiz_user")||"null")}catch{user=null}
(async()=>{const ok=await environmentCheck(true);if(ok){user&&safeEmail()?home():login();}})();
