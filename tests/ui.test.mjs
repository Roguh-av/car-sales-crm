import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as priority from '../priority-engine.mjs';
import {customerTimeline} from '../customer-history.mjs';
const {JSDOM}=await import(process.env.CRM_TEST_JSDOM||'jsdom');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(){
  const d={customers:[],leads:[],history:[],leases:[],finance:[],followups:[],outreach:[],leaseOutreach:[],deliveries:[],orders:[],dailyCalls:[],activity:[],access:[]};
  for(let i=0;i<12;i++){d.customers.push({id:'c'+i,name:'Test customer '+i});d.leads.push({id:'l'+i,customer_id:'c'+i,vehicle:'Test vehicle',priority:i===0?'Hot':'Normal',status:'New'})}
  return d;
}
function app(){
  const dom=new JSDOM(html,{url:'https://crm.test/',runScripts:'outside-only'}),w=dom.window;
  w.matchMedia=()=>({matches:false});w.alert=()=>{};w.confirm=()=>true;
  const d=fixture(),tableMap={lead_history:'history',finance_contracts:'finance',finance_outreach_history:'outreach',lease_outreach_history:'leaseOutreach',daily_priority_calls:'dailyCalls',customer_activity:'activity',crm_account_access:'access'};
  const state={d,fail:null,rpcs:[]};
  const sb={from(table){let after=null,limit=500;
    const q={select(){return q},order(){return q},limit(n){limit=n;return q},gt(k,v){after=v;return q},eq(){return q},maybeSingle(){return Promise.resolve({data:{status:'approved'}})},insert(row){state.d[tableMap[table]||table].push({...row,id:'new'+Date.now(),occurred_at:new Date().toISOString()});return Promise.resolve({error:null})},then(resolve,reject){const rows=state.d[tableMap[table]||table]||[];return Promise.resolve(state.fail===table?{error:{message:'Test query failure'}}:{data:rows.filter(x=>!after||x.id>after).sort((a,b)=>String(a.id).localeCompare(String(b.id))).slice(0,limit)}).then(resolve,reject)}};return q},async rpc(name,params){state.rpcs.push({name,params});return {error:null}},auth:{}};
  w.createClient=()=>sb;Object.assign(w,priority,{customerTimeline});
  let js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'').replace(/init\(\)\.catch\(err=>\{\$\('#authmsg'\)\.textContent=err\.message\}\);/,'');
  js+='\nwindow.testApi={setData(d){DB=d;user={id:"test-owner",email:"test@example.invalid"};readyUserId=user.id},getData(){return DB},render,readAll,load,acceptSession,page,priorityCalls,refreshVisibleCRM};';
  vm.runInContext(js,dom.getInternalVMContext());w.testApi.setData(d);
  return {dom,w,state,api:w.testApi,close:()=>w.close()};
}
test('existing dashboard renders 10 cards and all three calendar modes',()=>{const a=app();try{a.api.render();assert.equal(a.w.document.querySelectorAll('.priority-card').length,10);for(const view of ['Day','Week','Month'])assert.ok(a.w.document.body.textContent.includes(view));assert.ok(a.w.document.querySelector('#weekCalendar').children.length)}finally{a.close()}});
test('customer file opens combined history and saves a timestamped note',async()=>{const a=app();try{a.w.customerFile('c0');const f=a.w.document.querySelector('#customerNoteForm');assert.ok(f);f.elements.note.value='Test manual note';await f.onsubmit({preventDefault(){},target:f});assert.equal(a.state.d.activity.length,1);assert.ok(a.w.document.querySelector('#mbody').textContent.includes('Test manual note'))}finally{a.close()}});
test('Call & Update connects all 11 outcomes to the existing save RPC',async()=>{const a=app();try{a.api.render();a.w.openPriorityCall('Lead','l0');assert.equal(a.w.document.querySelectorAll('[data-priority-result]').length,11);const f=a.w.document.querySelector('#priorityCallForm');a.w.document.querySelector('[data-priority-result="Interested"]').click();f.elements.next_action_at.value='2030-01-02T10:00';f.elements.notes.value='Test call';await f.onsubmit({preventDefault(){}});assert.equal(a.state.rpcs.length,1);assert.equal(a.state.rpcs[0].name,'save_priority_call_result');assert.equal(a.state.rpcs[0].params.p_result,'Interested')}finally{a.close()}});
test('token refresh retains page and open form contents',()=>{const a=app();try{a.api.page('leases');a.w.customerFile('c0');a.w.document.querySelector('#customerNoteForm').elements.note.value='Unsaved note';a.api.acceptSession({user:{id:'test-owner',email:'test@example.invalid'}});assert.ok(!a.w.document.querySelector('#leases').classList.contains('hide'));assert.equal(a.w.document.querySelector('#customerNoteForm').elements.note.value,'Unsaved note')}finally{a.close()}});
test('data loading paginates beyond 1000 rows',async()=>{const a=app();try{a.state.d.customers=Array.from({length:1101},(_,i)=>({id:String(i).padStart(5,'0')}));assert.equal((await a.api.readAll('customers')).length,1101)}finally{a.close()}});
test('failed load preserves the previous complete snapshot',async()=>{const a=app();try{const old=a.api.getData();a.state.fail='finance_contracts';await assert.rejects(()=>a.api.load());assert.equal(a.api.getData(),old)}finally{a.close()}});
test('sign-out hides the app, closes customer data and clears memory',()=>{const a=app();try{a.w.customerFile('c0');a.api.acceptSession(null);assert.equal(a.api.getData().customers.length,0);assert.ok(a.w.document.querySelector('#crm').classList.contains('hide'));assert.equal(a.w.document.querySelector('#mbody').textContent,'')}finally{a.close()}});
