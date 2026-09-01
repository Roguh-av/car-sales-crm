const fs = require('fs');
const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

// Idempotent: Netlify builds from a clean checkout, but don't double-inject if run twice.
if (s.includes('id="approvalsNav"') && s.includes("crm_account_access")) {
  console.log('Account approval UI already injected.');
  process.exit(0);
}

function replaceRequired(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Could not find ${label} in index.html`);
  s = s.replace(oldText, newText);
}

// Mobile icon for approvals.
s = s.replace(
  '.nav button[data-p=leases]:before{content:"🟣"}.nav button[data-p=orders]:before{content:"📝"}.nav button[data-p=deliveries]:before{content:"📦"}',
  '.nav button[data-p=leases]:before{content:"🟣"}.nav button[data-p=orders]:before{content:"📝"}.nav button[data-p=approvals]:before{content:"🔐"}.nav button[data-p=deliveries]:before{content:"📦"}'
);

// Add an admin-only tab after Orders.
replaceRequired(
  '    <button data-p="orders">Orders</button>\n    <button data-p="completed">Sold / Lost / Delivered</button>',
  '    <button data-p="orders">Orders</button>\n    <button id="approvalsNav" class="hide" data-p="approvals">Account Approvals</button>\n    <button data-p="completed">Sold / Lost / Delivered</button>',
  'Orders navigation button'
);

// Add approvals page.
replaceRequired(
  '<section id="completed" class="page hide"><h1>Sold / Lost / Delivered</h1><div id="completedtable" class="section"></div></section>',
  '<section id="approvals" class="page hide"><div class="top"><div><h1>Account Approvals</h1><div class="label">Approve new salesperson accounts before they can use the CRM.</div></div></div><div id="approvaltable" class="section"></div></section>\n<section id="completed" class="page hide"><h1>Sold / Lost / Delivered</h1><div id="completedtable" class="section"></div></section>',
  'completed section'
);

replaceRequired(
  "let user=null,DB={customers:[],leads:[],history:[],followups:[],deliveries:[],leases:[],orders:[]},leadFilter='all',calFilter='all',weekOffset=0;",
  "let user=null,isAdmin=false,DB={customers:[],leads:[],history:[],followups:[],deliveries:[],leases:[],orders:[],access:[]},leadFilter='all',calFilter='all',weekOffset=0;",
  'CRM state declaration'
);

// Replace load() using function boundaries rather than fragile formatting.
let loadStart = s.indexOf('async function load(){');
let enterStart = s.indexOf('async function enter(){', loadStart);
if (loadStart < 0 || enterStart < 0) throw new Error('Could not locate load/enter functions');
s = s.slice(0, loadStart) + `async function load(){
  for(const [k,t] of Object.entries({customers:'customers',leads:'leads',history:'lead_history',followups:'followups',deliveries:'deliveries',leases:'leases',orders:'orders'})){
    let {data,error}=await sb.from(t).select('*');if(error)throw error;DB[k]=data||[]
  }
  if(isAdmin){let {data,error}=await sb.from('crm_account_access').select('user_id,email,status,is_admin,created_at,reviewed_at').order('created_at',{ascending:true});if(error)throw error;DB.access=data||[]}else DB.access=[]
}
` + s.slice(enterStart);

// Replace enter() so approval is enforced before CRM data is loaded.
let eStart = s.indexOf('async function enter(){');
let initStart = s.indexOf('async function init(){', eStart);
if (eStart < 0 || initStart < 0) throw new Error('Could not locate enter/init functions');
s = s.slice(0, eStart) + `async function enter(){
  let {data:access,error}=await sb.from('crm_account_access').select('user_id,email,status,is_admin').eq('user_id',user.id).maybeSingle();
  if(error){$('#authmsg').textContent='Unable to check account approval: '+error.message;return}
  if(!access||access.status!=='approved'){
    isAdmin=false;$('#crm').classList.add('hide');$('#auth').classList.remove('hide');
    $('#authmsg').innerHTML=access?.status==='rejected'?'This account was not approved. Contact the CRM administrator.<br><button id="pendingSignout" class="btn secondary" style="margin-top:10px">Sign out</button>':'Account created. Waiting for CRM administrator approval.<br><button id="pendingSignout" class="btn secondary" style="margin-top:10px">Sign out</button>';
    $('#pendingSignout').onclick=async()=>{await sb.auth.signOut();$('#authmsg').textContent='Signed out.'};return
  }
  isAdmin=!!access.is_admin;$('#approvalsNav').classList.toggle('hide',!isAdmin);
  await load();$('#auth').classList.add('hide');$('#crm').classList.remove('hide');render()
}
` + s.slice(initStart);

s = s.replace(
  "$('#signup').onclick=async()=>{let {data,error}=await sb.auth.signUp({email:$('#email').value,password:$('#password').value});$('#authmsg').textContent=error?.message||(data.session?'Account created.':'Check your email to confirm, then sign in.')};",
  "$('#signup').onclick=async()=>{let {data,error}=await sb.auth.signUp({email:$('#email').value,password:$('#password').value});$('#authmsg').textContent=error?.message||(data.session?'Account created. Waiting for administrator approval.':'Check your email to confirm. After confirmation, your account will wait for administrator approval.')};"
);

replaceRequired(
  'function render(){dashboard();leads();customers();leases();orders();deliveries();completed()}',
  'function render(){dashboard();leads();customers();leases();orders();deliveries();approvals();completed()}',
  'render function'
);

const approvalsCode = `function approvals(){if(!isAdmin||!$('#approvaltable'))return;$('#approvaltable').innerHTML=tab(['Email','Created','Status',''],DB.access.map(x=>\`<tr><td><b>\${esc(x.email||'No email')}</b>\${x.is_admin?'<div class="label">Administrator</div>':''}</td><td>\${fmt(x.created_at)}</td><td><span class="status-badge">\${esc(x.status)}</span></td><td>\${x.is_admin?'':x.status==='pending'?\`<div class="inline-actions"><button class="btn" onclick="reviewAccount('\${x.user_id}','approved')">Approve</button><button class="btn danger" onclick="reviewAccount('\${x.user_id}','rejected')">Reject</button></div>\`:\`<button class="btn secondary" onclick="reviewAccount('\${x.user_id}','\${x.status==='approved'?'rejected':'approved'}')">\${x.status==='approved'?'Revoke':'Approve'}</button>\`}</td></tr>\`))}
window.reviewAccount=async(id,status)=>{let {error}=await sb.rpc('review_crm_account',{p_user_id:id,p_status:status});if(error)return alert(error.message);await load();render();page('approvals')}
`;

let deliveriesPos = s.indexOf('function deliveries(){');
if (deliveriesPos < 0) throw new Error('Could not locate deliveries function for approvals insertion');
s = s.slice(0, deliveriesPos) + approvalsCode + s.slice(deliveriesPos);

fs.writeFileSync(path, s);
console.log('Injected account approval gate and admin approval UI.');
