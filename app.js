const API_URL="https://i.eptonline.org/quiz.php";

let quiz=null,user=null,answers={},startedAt=0,timerId=null,strikes=0,submitted=false,guardInstalled=false;
const app=document.getElementById("app");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

async function api(action, extra={}){
  const payload={action,...extra};
  const r=await fetch(API_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
    cache:"no-store"
  });
  let data={};
  try{data=await r.json()}catch(_){throw new Error("Backend returned an invalid response.")}

  if(!r.ok || !data.success) throw new Error(data.message||"Request failed.");
  return data;
}

async function loadJSON(url){
  const r=await fetch(url,{cache:"no-store"});
  if(!r.ok) throw new Error("Unable to load "+url);
  return r.json();
}

function saveLocal(state){
  localStorage.setItem("secureQuizState",JSON.stringify({
    email:user?.email||"",
    name:user?.name||"",
    state,
    updatedAt:new Date().toISOString()
  }));
}

function getLocalState(){
  try{
    const x=JSON.parse(localStorage.getItem("secureQuizState")||"null");
    if(x && user && x.email===user.email) return x.state;
  }catch(_){}
  return null;
}

function showLogin(message=""){
  app.innerHTML=`<section class="card">
    <div class="brand"><div class="badge">Q</div><div><h1>Secure Quiz Portal</h1><div class="muted">Authorized student access</div></div></div>
    <form id="loginForm">
      <label class="field">Email</label><input id="email" type="email" required autocomplete="username">
      <label class="field">Password</label><input id="password" type="password" required autocomplete="current-password">
      <div id="err" class="error">${esc(message)}</div>
      <div class="actions"><button class="btn primary">Sign In</button></div>
    </form>
  </section>`;
  document.getElementById("loginForm").onsubmit=login;
}

async function login(e){
  e.preventDefault();
  const email=document.getElementById("email").value.trim().toLowerCase();
  const password=document.getElementById("password").value;
  try{
    const users=await loadJSON("users.json");
    const found=users.find(u=>String(u.email).toLowerCase()===email && u.password===password);
    if(!found) throw new Error("Invalid credentials.");
    user=found;
    localStorage.setItem("quizUser",JSON.stringify(found));
    await showHome();
  }catch(x){document.getElementById("err").textContent=x.message}
}

async function showHome(){
  let status;
  try{
    status=await api("status",{email:user.email});
  }catch(e){
    app.innerHTML=`<section class="card"><h2>Unable to verify attempt</h2><p class="error">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></section>`;
    return;
  }

  const local=getLocalState();
  const attempted=status.attempted || ["STARTED","COMPLETED","CHEATED"].includes(local);

  app.innerHTML=`<section class="card">
    <div class="brand"><div class="badge">Q</div><div><h1>${esc(quiz.title)}</h1><div class="muted">${esc(user.name||user.email)} · ${esc(user.institution||"")}</div></div></div>
    ${attempted
      ? `<div class="warning"><b>Already attempted.</b><br>Name: ${esc(status.name||user.name||"Student")}<br>Status: ${esc(status.status||local||"ATTEMPTED")}<br><br>The Start Quiz button is disabled because only one attempt is allowed.</div>`
      : `<div class="notice"><b>Time:</b> ${quiz.timeLimitMinutes} minutes · <b>Attempts:</b> one</div>
         <p>Read all instructions before starting. Browser focus changes are monitored and may be recorded as cheating.</p>
         <div class="actions"><button id="start" class="btn gold">Start Quiz</button></div>`}
    <div class="actions"><button id="logout" class="btn danger">Log Out</button></div>
  </section>`;

  document.getElementById("logout").onclick=()=>{
    localStorage.removeItem("quizUser");
    location.reload();
  };

  const start=document.getElementById("start");
  if(start) start.onclick=showRules;
}

function showRules(){
  const d=document.createElement("div");
  d.className="modal-backdrop";
  d.innerHTML=`<div class="modal">
    <h2>Quiz Instructions</h2>
    <ul class="rules">
      <li>Only one attempt is permitted for each email.</li>
      <li>The quiz has a strict time limit.</li>
      <li>Do not open another tab/window, minimize the browser, or leave this page.</li>
      <li>Copy, paste, right-click and prohibited keyboard shortcuts are disabled as browser deterrents.</li>
      <li>Focus loss is recorded. A repeated focus violation will end the attempt.</li>
      <li>These controls are security deterrents; the server is the final authority for attempt status.</li>
    </ul>
    <div class="actions"><button id="attempt" class="btn primary">Attempt Quiz</button><button id="cancel" class="btn">Cancel</button></div>
  </div>`;
  document.body.appendChild(d);
  d.querySelector("#cancel").onclick=()=>d.remove();
  d.querySelector("#attempt").onclick=async()=>{
    d.remove();
    await reserveAttempt();
  };
}

async function reserveAttempt(){
  try{
    const result=await api("start",{
      user:{
        email:user.email,name:user.name||"",institution:user.institution||"",
        country:user.country||"",category:user.category||""
      },
      quizTitle:quiz.title
    });
    if(result.alreadyAttempted){
      saveLocal(result.status||"ATTEMPTED");
      await showHome();
      return;
    }
    saveLocal("STARTED");
    startedAt=Date.now();
    answers={};
    strikes=0;
    submitted=false;
    renderQuiz();
    installGuards();
    startTimer(quiz.timeLimitMinutes*60);
  }catch(e){
    app.innerHTML=`<section class="card"><h2>Cannot start quiz</h2><p class="error">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Return</button></section>`;
  }
}

function startTimer(seconds){
  tick(seconds);
  timerId=setInterval(()=>{
    seconds--;
    tick(seconds);
    if(seconds<=0){
      clearInterval(timerId);
      submitQuiz("timeout");
    }
  },1000);
}

function tick(seconds){
  const t=document.getElementById("timer");
  if(t)t.textContent=`${String(Math.max(0,Math.floor(seconds/60))).padStart(2,"0")}:${String(Math.max(0,seconds%60)).padStart(2,"0")}`;
}

function renderQuiz(){
  app.innerHTML=`<div class="topbar"><b>${esc(quiz.title)}</b><span class="timer" id="timer"></span></div>
  <main class="quiz-wrap"><form id="quizForm">
  ${quiz.questions.map((q,i)=>qHTML(q,i)).join("")}
  <div class="actions"><button class="btn gold">Submit Quiz</button></div>
  </form></main>`;

  quiz.questions.forEach(q=>{
    document.querySelectorAll(`[name="${q.id}"]`).forEach(x=>{
      x.onchange=()=>{
        answers[q.id]=q.type==="multi"
          ? [...document.querySelectorAll(`[name="${q.id}"]:checked`)].map(y=>y.value)
          : x.value;
      };
    });
    if(q.type==="text"){
      const el=document.getElementById(q.id);
      el.oninput=e=>answers[q.id]=e.target.value;
    }
  });

  document.getElementById("quizForm").onsubmit=e=>{
    e.preventDefault();
    if(confirm("Submit your quiz now?")) submitQuiz("manual");
  };
}

function qHTML(q,i){
  if(q.type==="text")
    return `<section class="qcard"><div class="qnum">Question ${i+1}</div><p><b>${esc(q.text)}</b></p><input id="${esc(q.id)}" type="text" autocomplete="off"></section>`;

  const typ=q.type==="multi"?"checkbox":"radio";
  return `<section class="qcard"><div class="qnum">Question ${i+1}</div><p><b>${esc(q.text)}</b></p>
  ${q.options.map(o=>`<label class="option"><input type="${typ}" name="${esc(q.id)}" value="${esc(o)}">${esc(o)}</label>`).join("")}</section>`;
}

function installGuards(){
  if(guardInstalled)return;
  guardInstalled=true;

  document.addEventListener("contextmenu",block,false);
  document.addEventListener("copy",block,false);
  document.addEventListener("cut",block,false);
  document.addEventListener("selectstart",block,false);
  document.addEventListener("dragstart",block,false);
  document.addEventListener("keydown",keyboardBlock,false);
  document.addEventListener("visibilitychange",focusViolation,false);
  window.addEventListener("blur",focusViolation,false);
  window.addEventListener("beforeunload",beforeUnload,false);
}

function block(e){if(!submitted)e.preventDefault()}

function keyboardBlock(e){
  if(submitted)return;
  const k=e.key.toLowerCase();
  if(
    e.key==="F12" ||
    (e.ctrlKey && ["a","c","v","x","u","s","p"].includes(k)) ||
    (e.ctrlKey && e.shiftKey && ["i","j","c"].includes(k))
  ){
    e.preventDefault();
    e.stopPropagation();
  }
}

let lastFocusEvent=0;
async function focusViolation(){
  if(submitted)return;
  if(document.visibilityState==="visible" && document.hasFocus())return;

  const now=Date.now();
  if(now-lastFocusEvent<1200)return;
  lastFocusEvent=now;

  strikes++;
  saveLocal("STARTED");

  try{
    const result=await api("cheat",{
      email:user.email,
      name:user.name||"",
      reason:"TAB_OR_WINDOW_FOCUS_LOST",
      strikes
    });

    if(result.blocked){
      await finishCheating(result.message||`Name ${user.name}: you tried to do cheating.`);
    }else{
      alert(`Security warning: ${user.name||"Student"}, you tried to do cheating. Focus loss ${strikes}/2 has been recorded.`);
    }
  }catch(e){
    alert(`Security warning: ${user.name||"Student"}, focus loss was detected. ${e.message}`);
  }
}

function beforeUnload(e){
  if(!submitted){
    e.preventDefault();
    e.returnValue="";
  }
}

async function finishCheating(message){
  if(submitted)return;
  submitted=true;
  clearInterval(timerId);
  saveLocal("CHEATED");
  app.innerHTML=`<section class="card"><h2>Attempt Terminated</h2><p class="error">${esc(message)}</p><p>Your attempt has been recorded as a security violation. You cannot start another attempt.</p></section>`;
}

async function submitQuiz(reason){
  if(submitted)return;
  submitted=true;
  clearInterval(timerId);

  const payload={
    user:{
      email:user.email,name:user.name||"",institution:user.institution||"",
      country:user.country||"",category:user.category||""
    },
    quizTitle:quiz.title,
    questions:quiz.questions.map(q=>({
      id:q.id,
      response:answers[q.id]??(q.type==="multi"?[]:"")
    })),
    timeTakenSeconds:Math.round((Date.now()-startedAt)/1000),
    clientReason:reason,
    submissionTimestamp:new Date().toISOString()
  };

  app.innerHTML=`<section class="card"><h2>Submitting…</h2><p class="muted">Please do not close this page.</p></section>`;

  try{
    const d=await api("submit",payload);
    saveLocal("COMPLETED");
    app.innerHTML=`<section class="card">
      <h2>Submission Complete</h2>
      <p class="success">Your quiz was successfully recorded.</p>
      <p><b>Student:</b> ${esc(user.name||user.email)}</p>
      <p><b>Score:</b> ${esc(d.score)}</p>
      <p><b>Percentile:</b> ${esc(d.percentile)}%</p>
      <p class="muted">${esc(d.emailMessage||"Certificate email status is recorded by the server.")}</p>
    </section>`;
  }catch(e){
    /* Keep local state STARTED so the student can retry submission after a temporary network error. */
    submitted=false;
    saveLocal("STARTED");
    app.innerHTML=`<section class="card"><h2>Submission Error</h2><p class="error">${esc(e.message)}</p><p>Your attempt remains reserved. Do not start another attempt. Refresh and retry submission if this was a temporary network problem.</p><button class="btn primary" onclick="location.reload()">Retry</button></section>`;
  }
}

(async()=>{
  try{
    quiz=await loadJSON("quiz.json");
    const saved=localStorage.getItem("quizUser");
    if(saved)user=JSON.parse(saved);
    user?await showHome():showLogin();
  }catch(e){
    app.innerHTML=`<section class="card"><h2>Configuration Error</h2><p class="error">${esc(e.message)}</p></section>`;
  }
})();
