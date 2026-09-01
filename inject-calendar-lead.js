const fs=require('fs');
const path='index.html';
let s=fs.readFileSync(path,'utf8');

if(s.includes('CRM_CALENDAR_LEAD_V1')){
  console.log('Calendar lead-link behavior already injected.');
  process.exit(0);
}

function req(oldText,newText,label){
  if(!s.includes(oldText)) throw new Error(`Could not find ${label}`);
  s=s.replace(oldText,newText);
}

// Calendar follow-up events: linked lead -> open lead file. Unlinked -> normal calendar editor.
req(
  "ev.push(`<button class=\"event ${cl}\" onclick=\"openCalendarFollowup('${x.id}')\">${esc(x.action_type)}<br><b>${esc(cust(x.customer_id).name)}</b></button>`)",
  "ev.push(`<button class=\"event ${cl}\" onclick=\"${x.lead_id?`openLeadFile('${x.lead_id}')`:`openCalendarFollowup('${x.id}')`}\">${esc(x.action_type)}<br><b>${esc(cust(x.customer_id).name)}</b></button>`)",
  'calendar follow-up event click handler'
);

// Prevent the native date/time picker from opening from the same click/tap that opened the modal.
// It remains a normal datetime-local field and opens only when the user intentionally clicks it.
const marker="/* CRM_CALENDAR_LEAD_V1 */\nfunction armDateTimePicker(){\n  const el=document.querySelector('#modal input[type=\\\"datetime-local\\\"]');\n  if(!el)return;\n  el.style.pointerEvents='none';\n  el.blur();\n  setTimeout(()=>{el.style.pointerEvents='auto'},280);\n}\n";

const firstEditor="  wireCustomerSearch($('#f'));\n  $('#f').onsubmit=async e=>{e.preventDefault();let o=Object.fromEntries(new FormData(e.target));if(!o.customer_id)return alert('Select a customer');let {error}=await sb.from('followups').update({customer_id:o.customer_id,action_type:o.action_type,scheduled_at:new Date(o.scheduled_at).toISOString(),status:o.status,notes:o.notes||null}).eq('id',id);if(error)return alert(error.message);closeModal();await load();render()};";
if(!s.includes(firstEditor)) throw new Error('Could not find calendar follow-up editor submit block');
s=s.replace(firstEditor,"  wireCustomerSearch($('#f'));\n  armDateTimePicker();\n  $('#f').onsubmit=async e=>{e.preventDefault();let o=Object.fromEntries(new FormData(e.target));if(!o.customer_id)return alert('Select a customer');let {error}=await sb.from('followups').update({customer_id:o.customer_id,action_type:o.action_type,scheduled_at:new Date(o.scheduled_at).toISOString(),status:o.status,notes:o.notes||null}).eq('id',id);if(error)return alert(error.message);closeModal();await load();render()};");

// Insert helper before the follow-up editor. Works for both normal and post-delivery generic editors.
const editorPos=s.indexOf('window.openCalendarFollowupGeneric=id=>{');
const fallbackPos=s.indexOf('window.openCalendarFollowup=id=>{');
const pos=editorPos>=0?editorPos:fallbackPos;
if(pos<0) throw new Error('Could not locate calendar editor for helper insertion');
s=s.slice(0,pos)+marker+s.slice(pos);

// If the generic post-delivery editor exists, protect its date field too.
const genericWire="  wireCustomerSearch($('#f'));\n  $('#f').onsubmit=async e=>{e.preventDefault();let o=Object.fromEntries(new FormData(e.target));if(!o.customer_id)return alert('Select a customer');let {error}=await sb.from('followups').update({customer_id:o.customer_id,action_type:o.action_type,scheduled_at:new Date(o.scheduled_at).toISOString(),status:o.status,notes:o.notes||null}).eq('id',id);if(error)return alert(error.message);closeModal();await load();render()};";
if(s.includes(genericWire)) s=s.replace(genericWire,"  wireCustomerSearch($('#f'));\n  armDateTimePicker();\n  $('#f').onsubmit=async e=>{e.preventDefault();let o=Object.fromEntries(new FormData(e.target));if(!o.customer_id)return alert('Select a customer');let {error}=await sb.from('followups').update({customer_id:o.customer_id,action_type:o.action_type,scheduled_at:new Date(o.scheduled_at).toISOString(),status:o.status,notes:o.notes||null}).eq('id',id);if(error)return alert(error.message);closeModal();await load();render()};");

fs.writeFileSync(path,s);
console.log('Injected click-to-open date behavior and calendar-to-lead navigation.');
