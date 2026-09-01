const fs = require('fs');
const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

if (s.includes('id="sidebarToggle"') && s.includes('sidebar-collapsed')) {
  console.log('Collapsible sidebar already injected.');
  process.exit(0);
}

const style = `
/* Collapsible sidebar */
.side,.main{transition:transform .22s ease,margin-left .22s ease,width .22s ease}
.sidebar-toggle{position:fixed;left:12px;top:12px;z-index:80;width:44px;height:44px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--text);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;box-shadow:0 8px 24px #0005}
.sidebar-overlay{position:fixed;inset:0;background:#0008;z-index:59;display:none}
.app.sidebar-collapsed .side{transform:translateX(-100%)}
.app.sidebar-collapsed .main{margin-left:0;width:100%}
.app.sidebar-collapsed .sidebar-toggle{left:12px}
.app:not(.sidebar-collapsed) .sidebar-toggle{left:247px}
@media(max-width:800px){
 .side{width:70px;z-index:60;transform:translateX(-100%)}
 .main{margin-left:0!important;width:100%!important;padding-top:68px}
 .app.sidebar-open .side{transform:translateX(0)}
 .app.sidebar-open .sidebar-overlay{display:block}
 .app .sidebar-toggle,.app:not(.sidebar-collapsed) .sidebar-toggle{left:10px;top:10px}
}
`;
if (!s.includes('</style>')) throw new Error('Could not find closing style tag');
s = s.replace('</style>', style + '\n</style>');

const crmOpen = '<div id="crm" class="app hide">';
if (!s.includes(crmOpen)) throw new Error('Could not find CRM app wrapper');
s = s.replace(crmOpen, `${crmOpen}\n<button id="sidebarToggle" class="sidebar-toggle" type="button" aria-label="Open navigation" title="Open / close menu">☰</button>\n<div id="sidebarOverlay" class="sidebar-overlay"></div>`);

const behavior = `
function setupSidebarToggle(){
  const app=$('#crm'),toggle=$('#sidebarToggle'),overlay=$('#sidebarOverlay'),side=$('.side');
  if(!app||!toggle||!overlay||!side)return;
  const mobile=()=>window.matchMedia('(max-width:800px)').matches;
  const sync=()=>{
    if(mobile()){
      const open=app.classList.contains('sidebar-open');
      toggle.textContent=open?'×':'☰';
      toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    }else{
      const collapsed=app.classList.contains('sidebar-collapsed');
      toggle.textContent=collapsed?'☰':'‹';
      toggle.setAttribute('aria-label',collapsed?'Open navigation':'Collapse navigation');
    }
  };
  const closeMobile=()=>{app.classList.remove('sidebar-open');sync()};
  toggle.onclick=()=>{
    if(mobile()) app.classList.toggle('sidebar-open');
    else app.classList.toggle('sidebar-collapsed');
    sync();
  };
  overlay.onclick=closeMobile;
  $$('.nav button[data-p]').forEach(b=>b.addEventListener('click',()=>{if(mobile())closeMobile()}));
  window.addEventListener('resize',()=>{if(!mobile())app.classList.remove('sidebar-open');sync()});
  sync();
}
setupSidebarToggle();
`;
if (!s.includes('init();')) throw new Error('Could not find init call');
s = s.replace('init();', behavior + '\ninit();');

fs.writeFileSync(path, s);
console.log('Injected collapsible sidebar.');
