import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Test dependency is isolated from the buildless production application.
const {PGlite}=await import(process.env.CRM_TEST_PGLITE||'@electric-sql/pglite');
const sql=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
const pg=new PGlite();
for(const file of ['./schema-fixture.sql','../supabase/crm_integrity_v2.sql','../supabase/call_workflow_v2.sql']){
  try{await pg.exec(sql(file))}catch(error){console.error(file,error.message,error.where||'');await pg.close();process.exit(1)}
}
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',pending='10000000-0000-4000-8000-000000000003';
await pg.query('insert into auth.users(id) values ($1),($2),($3)',[owner,other,pending]);
await pg.query("insert into public.crm_account_access(user_id,status) values ($1,'approved'),($2,'approved'),($3,'pending')",[owner,other,pending]);
await pg.exec("set role authenticated");
await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
async function one(query,args=[]){return (await pg.query(query,args)).rows[0]}
async function seed(type='Lead'){
  const c=await one("insert into customers(name) values ('Test only') returning id");
  const table=type==='Lead'?'leads':type==='Lease'?'leases':'finance_contracts';
  const o=await one(`insert into ${table}(customer_id,vehicle) values ($1,'Test vehicle') returning id`,[c.id]);
  return {cid:c.id,id:o.id,table,col:type==='Lead'?'lead_id':type==='Lease'?'lease_contract_id':'finance_contract_id',type};
}
async function call(o,result='Interested',next='2030-01-02T15:00:00Z'){
  return one('select save_priority_call_result($1,$2,$3,$4,$5,150,$6) id',[o.type,o.id,result,'Test call note',next,'Test reason']);
}
async function rollback(fn){await pg.exec('begin');try{await fn()}finally{await pg.exec('rollback')}}
test('authenticated call persists, reloads, and creates one linked next action for all opportunity types',()=>rollback(async()=>{
  for(const type of ['Lead','Lease','Finance']){
    const o=await seed(type);await call(o);
    const action=await one(`select * from followups where ${o.col}=$1 and status='Open'`,[o.id]);
    assert.equal(action.customer_id,o.cid);assert.equal(action.notes,'Interested: Test call note');
    const saved=await one(`select * from ${o.table} where id=$1`,[o.id]);
    assert.equal(new Date(saved[type==='Lead'?'next_action_at':'next_contact_at']).toISOString(),'2030-01-02T15:00:00.000Z');
    assert.equal((await one('select result from daily_priority_calls where opportunity_id=$1',[o.id])).result,'Interested');
    if(type==='Lead')assert.equal((await one("select count(*)::int n from lead_history where lead_id=$1 and event_type='Priority call'",[o.id])).n,1);
    else assert.equal((await one(`select count(*)::int n from ${type==='Lease'?'lease':'finance'}_outreach_history where ${o.col}=$1`,[o.id])).n,1);
  }
}));
test('repeat call replaces obsolete next action without deleting history',()=>rollback(async()=>{
  const o=await seed('Finance');await call(o);await call(o,'Follow up later','2030-01-03T15:00:00Z');
  assert.equal((await one("select count(*)::int n from followups where finance_contract_id=$1 and status='Open'",[o.id])).n,1);
  assert.equal((await one("select count(*)::int n from followups where finance_contract_id=$1 and cancelled_at is not null",[o.id])).n,1);
  assert.equal((await one('select count(*)::int n from finance_outreach_history where finance_contract_id=$1',[o.id])).n,2);
}));
test('calendar edit/completion synchronizes earliest remaining next action atomically',()=>rollback(async()=>{
  const o=await seed('Lease');await call(o);
  const f=await one('select id from followups where lease_contract_id=$1',[o.id]);
  await pg.query("update followups set scheduled_at='2030-02-01T15:00:00Z' where id=$1",[f.id]);
  assert.equal(new Date((await one('select next_contact_at from leases where id=$1',[o.id])).next_contact_at).toISOString(),'2030-02-01T15:00:00.000Z');
  await pg.query("insert into followups(customer_id,lease_contract_id,action_type,scheduled_at) values($1,$2,'Appointment','2030-03-01T15:00:00Z')",[o.cid,o.id]);
  await pg.query("update followups set status='Done' where id=$1",[f.id]);
  assert.ok((await one('select completed_at from followups where id=$1',[f.id])).completed_at);
  assert.equal(new Date((await one('select next_contact_at from leases where id=$1',[o.id])).next_contact_at).toISOString(),'2030-03-01T15:00:00.000Z');
}));
test('removing lease preserves customer, outreach, reminders and completed daily record',()=>rollback(async()=>{
  const o=await seed('Lease');await call(o);await pg.query('select remove_lease_opportunity($1,$2)',[o.id,'Another salesperson']);
  assert.ok((await one('select removed_at from leases where id=$1',[o.id])).removed_at);
  assert.ok(await one('select id from customers where id=$1',[o.cid]));
  assert.equal((await one('select count(*)::int n from daily_priority_calls where opportunity_id=$1',[o.id])).n,1);
  assert.equal((await one('select count(*)::int n from lease_outreach_history where lease_contract_id=$1',[o.id])).n,1);
  assert.equal((await one("select count(*)::int n from followups where lease_contract_id=$1 and status='Cancelled'",[o.id])).n,1);
  await assert.rejects(()=>call(o),/not found/);
}));
test('closed priority opportunities cannot be reopened by a stale call form',()=>rollback(async()=>{
  for(const type of ['Lead','Lease','Finance']){
    const o=await seed(type);await call(o,'Keeping vehicle',null);
    await pg.exec('savepoint closedcheck');await assert.rejects(()=>call(o),/not found|closed/);await pg.exec('rollback to closedcheck');
    assert.equal((await one(`select count(*)::int n from followups where ${o.col}=$1 and status='Open'`,[o.id])).n,0);
  }
}));
test('DNC cancels all customer reminders and refuses further calls',()=>rollback(async()=>{
  const o=await seed('Finance');await call(o);await call(o,'Do Not Contact',null);
  assert.equal((await one('select status from customers where id=$1',[o.cid])).status,'Do Not Contact');
  assert.equal((await one("select count(*)::int n from followups where customer_id=$1 and status='Open'",[o.cid])).n,0);
  await assert.rejects(()=>pg.query("select save_finance_outreach($1,'Interested','Test','2030-01-01')",[o.id]),/Do Not Contact/);
}));
test('missing/past next dates fail without partially saving',()=>rollback(async()=>{
  const o=await seed();
  for(const date of [null,'2000-01-01']){await pg.exec('savepoint invalid');await assert.rejects(()=>call(o,'Spoke',date),/next action/);await pg.exec('rollback to invalid')}
  assert.equal((await one('select count(*)::int n from daily_priority_calls where opportunity_id=$1',[o.id])).n,0);
}));
test('different owner cannot read or update an opportunity or inject notes',()=>rollback(async()=>{
  const o=await seed();await pg.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
  assert.equal((await pg.query('select id from leads where id=$1',[o.id])).rows.length,0);
  await pg.exec('savepoint foreigncall');await assert.rejects(()=>call(o),/not found/);await pg.exec('rollback to foreigncall');
  await pg.exec('savepoint foreignnote');await assert.rejects(()=>pg.query("insert into customer_activity(customer_id,kind,note) values($1,'Note','Test')",[o.cid]),/row-level security/);await pg.exec('rollback to foreignnote');
}));
test('unapproved account cannot use call RPC',()=>rollback(async()=>{
  const o=await seed();await pg.query("select set_config('request.jwt.claim.sub',$1,true)",[pending]);await assert.rejects(()=>call(o),/Access denied/);
}));
test('mismatched linked customer is rejected with no partial schedule changes',()=>rollback(async()=>{
  const o=await seed('Lease'),wrong=await seed();
  await assert.rejects(()=>pg.query("insert into followups(customer_id,lease_contract_id,action_type,scheduled_at) values($1,$2,'Call','2030-01-01')",[wrong.cid,o.id]),/same customer|another customer/);
}));
test('manual notes and status history persist under authenticated permissions',()=>rollback(async()=>{
  const o=await seed();await pg.query("insert into customer_activity(customer_id,kind,note) values($1,'Note','Manual test note')",[o.cid]);
  const note=await one("select note,occurred_at from customer_activity where customer_id=$1 and kind='Note'",[o.cid]);assert.equal(note.note,'Manual test note');assert.ok(note.occurred_at);
  await pg.query("update leads set status='Showed' where id=$1",[o.id]);
  assert.equal((await one("select count(*)::int n from lead_history where lead_id=$1 and event_type='Status changed'",[o.id])).n,1);
}));
test('delivery rescheduling keeps one thank-you reminder',()=>rollback(async()=>{
  const o=await seed();const d=await one("insert into deliveries(customer_id,lead_id,vehicle,status,delivery_at) values($1,$2,'Test vehicle','Delivered','2030-01-01') returning id",[o.cid,o.id]);
  await pg.query("update deliveries set delivery_at='2030-01-02' where id=$1",[d.id]);
  assert.equal((await one('select count(*)::int n from followups where delivery_id=$1',[d.id])).n,1);
}));
test.after(()=>pg.close());
