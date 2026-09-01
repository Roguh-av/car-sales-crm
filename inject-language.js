const fs = require('fs');
const path = 'index.html';
let s = fs.readFileSync(path, 'utf8');

if (s.includes('CUSTOMER_LANGUAGE_V1')) {
  console.log('Customer language support already injected.');
  process.exit(0);
}

function replaceRequired(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Could not find ${label} in index.html`);
  s = s.replace(oldText, newText);
}

// Marker so this script is safe if a build ever runs it twice.
replaceRequired(
  "const dateFmt=x=>x?new Date(x+'T12:00:00').toLocaleDateString([],{dateStyle:'medium'}):'—';",
  "const dateFmt=x=>x?new Date(x+'T12:00:00').toLocaleDateString([],{dateStyle:'medium'}):'—';\n/* CUSTOMER_LANGUAGE_V1 */",
  'date formatter marker'
);

// Ask for language when a brand-new customer is created from New Lead.
replaceRequired(
  '<label>New Customer Name<input name="name"></label><label>Phone<input name="phone"></label>',
  '<label>New Customer Name<input name="name"></label><label>Phone<input name="phone"></label><label>New Customer Language<select name="language"><option>English</option><option>French</option></select></label>',
  'new lead customer fields'
);
replaceRequired(
  "name:o.name,phone:o.phone||null,source:o.source",
  "name:o.name,phone:o.phone||null,source:o.source,language:o.language||'English'",
  'new lead customer insert'
);

// Ask for language on the normal New Customer form.
replaceRequired(
  '<label>Email<input name="email"></label><label>City<input name="city"></label><label class="full">Notes<textarea name="notes"></textarea></label>',
  '<label>Email<input name="email"></label><label>City<input name="city"></label><label>Language<select name="language"><option>English</option><option>French</option></select></label><label class="full">Notes<textarea name="notes"></textarea></label>',
  'new customer language field'
);

// Show language in the customer list.
replaceRequired(
  "$('#custtable').innerHTML=tab(['Name','Phone','City','Status'],a.map(x=>`<tr><td><button class=\"btn secondary\" onclick=\"customerFile('${x.id}')\">${esc(x.name)}</button></td><td>${esc(x.phone||'')}</td><td>${esc(x.city||'')}</td><td>${esc(x.status||'')}</td></tr>`))",
  "$('#custtable').innerHTML=tab(['Name','Phone','City','Language','Status'],a.map(x=>`<tr><td><button class=\"btn secondary\" onclick=\"customerFile('${x.id}')\">${esc(x.name)}</button></td><td>${esc(x.phone||'')}</td><td>${esc(x.city||'')}</td><td>${esc(x.language||'English')}</td><td>${esc(x.status||'')}</td></tr>`))",
  'customer table'
);

// Show language in customer search suggestions.
s = s.replace(
  '<div class="label">${esc(c.phone||\'\')} ${esc(c.email||\'\')}</div>',
  '<div class="label">${esc(c.phone||\'\')} ${esc(c.email||\'\')} · ${esc(c.language||\'English\')}</div>'
);

// Let existing customers be edited, especially their preferred language.
const editCustomerCode = `window.editCustomer=id=>{
  const c=cust(id);if(!c)return;
  modal('Edit Customer',\`<form id="f" class="form"><label>Name<input name="name" required value="\${esc(c.name||'')}"></label><label>Phone<input name="phone" value="\${esc(c.phone||'')}"></label><label>Email<input name="email" value="\${esc(c.email||'')}"></label><label>City<input name="city" value="\${esc(c.city||'')}"></label><label>Language<select name="language"><option \${(c.language||'English')==='English'?'selected':''}>English</option><option \${c.language==='French'?'selected':''}>French</option></select></label><label class="full">Notes<textarea name="notes">\${esc(c.notes||'')}</textarea></label><div class="full"><button class="btn">Save Customer</button></div></form>\`);
  $('#f').onsubmit=async e=>{e.preventDefault();let o=Object.fromEntries(new FormData(e.target));let {error}=await sb.from('customers').update({name:o.name,phone:o.phone||null,email:o.email||null,city:o.city||null,language:o.language,notes:o.notes||null}).eq('id',id);if(error)return alert(error.message);closeModal();await load();render();customerFile(id)}
}
`;
const customerFilePos = s.indexOf('window.customerFile=id=>{');
if (customerFilePos < 0) throw new Error('Could not locate customer file function');
s = s.slice(0, customerFilePos) + editCustomerCode + s.slice(customerFilePos);

replaceRequired(
  '<div class="card"><b>${esc(c.phone||\'\')}</b><div>${esc(c.email||\'\')}</div><div>${esc(c.city||\'\')}</div></div>',
  '<div class="card"><b>${esc(c.phone||\'\')}</b><div>${esc(c.email||\'\')}</div><div>${esc(c.city||\'\')}</div><div class="label" style="margin-top:6px">Language: ${esc(c.language||\'English\')}</div><div style="margin-top:9px"><button class="btn secondary" onclick="editCustomer(\'${c.id}\')">Edit Customer</button></div></div>',
  'customer file header'
);

// Build the post-delivery message in the customer's preferred language.
replaceRequired(
  "  const message=`Hi ${first}, thank you again for choosing me for your ${vehicle}! I hope you're enjoying it. If you have any questions or need anything, feel free to reach out anytime.`;",
  "  const language=c.language||'English';\n  const message=language==='French'?`Bonjour ${first}, merci encore de m'avoir fait confiance pour l'achat de votre ${vehicle}! J'espère que tout se passe bien et que vous en profitez pleinement. Si vous avez des questions ou avez besoin de quoi que ce soit, n'hésitez pas à me contacter.`:`Hi ${first}, thank you again for choosing me for your ${vehicle}! I hope you're enjoying it. If you have any questions or need anything, feel free to reach out anytime.`;",
  'post-delivery thank-you message'
);
replaceRequired(
  "${esc(c.phone||'No phone number')} · ${esc(vehicle)}",
  "${esc(c.phone||'No phone number')} · ${esc(vehicle)} · ${esc(c.language||'English')}",
  'thank-you language display'
);

fs.writeFileSync(path, s);
console.log('Injected customer English/French language support and language-aware thank-you texts.');
