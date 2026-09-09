// Pure, deterministic rules. No network, generated customer data, or inferred contact.
const DAY = 86400000;
export const businessDay = (value = Date.now()) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const time = value => value ? new Date(value).getTime() : NaN;
const valid = value => Number.isFinite(time(value));
const dayNumber = value => Date.parse(businessDay(value)+'T00:00:00Z') / DAY;
const age = (value, now) => valid(value) ? Math.max(0, dayNumber(now)-dayNumber(value)) : null;
const closed = value => ['sold','lost','do not contact','closed','keeping vehicle','not interested','buying out lease','returning vehicle'].includes(String(value||'').toLowerCase());
export const isOpenAction = action => !action.cancelled_at && !['Done','Cancelled','Missed'].includes(action.status);
export function relevantActions(db, candidate) {
  return db.followups.filter(x => x.customer_id===candidate.customerId && (
    (candidate.type==='Lead' && x.lead_id===candidate.id) ||
    (candidate.type==='Lease' && x.lease_contract_id===candidate.id) ||
    (candidate.type==='Finance' && x.finance_contract_id===candidate.id) ||
    (!x.lead_id && !x.lease_contract_id && !x.finance_contract_id && !x.delivery_id)
  ));
}
export function lastContact(db, candidate, now=Date.now()) {
  // Contact is customer-wide: another opportunity's call should not cause a repeat call.
  const leadIds = new Set(db.leads.filter(x=>x.customer_id===candidate.customerId).map(x=>x.id));
  const dates = [
    ...db.history.filter(x=>leadIds.has(x.lead_id) && ['Priority call','Call completed','Text sent','Email sent','Contact recorded'].includes(x.event_type)).map(x=>x.occurred_at),
    ...db.outreach.filter(x=>x.customer_id===candidate.customerId).map(x=>x.created_at),
    ...db.leaseOutreach.filter(x=>x.customer_id===candidate.customerId).map(x=>x.created_at),
    ...db.finance.filter(x=>x.customer_id===candidate.customerId).map(x=>x.last_contact_at),
    ...db.leases.filter(x=>x.customer_id===candidate.customerId).map(x=>x.last_contact_at),
    ...db.followups.filter(x=>x.customer_id===candidate.customerId && x.status==='Done' && !x.cancelled_at && ['Call','Text','Email','Finance follow-up','Lease follow-up','Post-delivery thank you'].includes(x.action_type)).map(x=>x.completed_at)
  ].filter(x=>valid(x) && time(x)<=time(now));
  return dates.sort((a,b)=>time(b)-time(a))[0]||null;
}
export function nextAction(db,candidate) {
  const actions = relevantActions(db,candidate);
  const dates = actions.filter(isOpenAction).map(x=>x.scheduled_at).filter(valid);
  // Legacy explicit dates are usable only without linked actions; completed actions
  // must not be resurrected by an old denormalized next_action_at value.
  if (!actions.length) dates.push(candidate.type==='Lead'?candidate.record.next_action_at:candidate.record.next_contact_at);
  return dates.filter(valid).sort((a,b)=>time(a)-time(b))[0]||null;
}
export function scoreCandidate(db,candidate,now=Date.now()) {
  const record=candidate.record, reasons=[], missing=[];
  let score=0;
  const add=(points,text)=>{score+=points;reasons.push({points,text})};
  const last=lastContact(db,candidate,now), days=age(last,now);
  const actions=relevantActions(db,candidate), open=actions.filter(isOpenAction);
  const next=nextAction(db,candidate), due=next?dayNumber(now)-dayNumber(next):null;
  const future=open.filter(x=>time(x.scheduled_at)>time(now));
  const booked=db.followups.some(x=>x.customer_id===candidate.customerId && isOpenAction(x) && x.action_type==='Appointment' && time(x.scheduled_at)>time(now));
  const scheduledFuture=future.length>0 || (valid(next)&&time(next)>time(now));
  if(candidate.type==='Lead' && record.priority==='Hot') add(150,`Hot lead${days===null?'':days===0?' — contacted today':` — no contact in ${days} day${days===1?'':'s'}`}`);
  if(due>0) add(130+Math.min(due,10),`Next action overdue by ${due} day${due===1?'':'s'}`);
  else if(due===0) add(115,'Next action is due today');
  const missed=actions.filter(x=>!x.cancelled_at && x.action_type==='Appointment' && x.status==='Missed' && time(x.scheduled_at)<time(now) && (!last||time(last)<time(x.scheduled_at))).sort((a,b)=>time(b.scheduled_at)-time(a.scheduled_at))[0];
  if(missed) {const days=age(missed.scheduled_at,now);add(125,days===0?'Missed appointment today':days===1?'Missed appointment yesterday':`Missed appointment ${days} days ago`)}
  else if(open.some(x=>x.action_type==='Appointment' && time(x.scheduled_at)<time(now) && (!last||time(last)<time(x.scheduled_at)))) add(65,'Past appointment — outcome not recorded');
  const history=db.history.filter(x=>candidate.type==='Lead' && x.lead_id===candidate.id && valid(x.occurred_at) && time(x.occurred_at)<=time(now));
  const visits=history.filter(x=>x.event_type==='Visit completed' || (x.event_type==='Status changed' && /→ Showed$/.test(x.note||'')));
  const recentVisit=visits.some(x=>age(x.occurred_at,now)<=14);
  if(recentVisit) add(95,'Dealership visit in the last 14 days — no sale recorded');
  const quote=history.filter(x=>x.event_type==='Quote sent').sort((a,b)=>time(b.occurred_at)-time(a.occurred_at))[0];
  const quoteClosed=quote && history.some(x=>['Quote accepted','Quote declined','Quote withdrawn'].includes(x.event_type) && time(x.occurred_at)>=time(quote.occurred_at));
  if(quote && !quoteClosed && !scheduledFuture && (!last||time(last)<=time(quote.occurred_at))) add(110,'Quote sent — no follow-up recorded');
  if(record.status==='Negotiating' && !quote) add(55,'Lead is negotiating — quote details not recorded');
  const interest=record.opportunity_status==='Interested' || history.some(x=>x.event_type==='Interest expressed' || (x.event_type==='Priority call' && /^(Interested|Changing vehicle)(:|$)/.test(x.note||'')));
  if(interest) add(85,'Interested in changing vehicles');
  if(candidate.type==='Lease') {
    if(/^\d{4}-\d{2}-\d{2}$/.test(record.lease_end_date||'')) {
      const left=(Date.parse(record.lease_end_date+'T00:00:00Z')/DAY)-dayNumber(now);
      if(left<0) add(100,`Lease maturity passed ${Math.abs(left)} days ago — verify status`);
      else if(left<=30) add(135,left===0?'Lease ends today':`Lease ends in ${left} days`);
      else if(left<=180) add(100,`Lease ends in ${left} days`);
      else if(left<=365) add(70,`Lease ends in ${left} days`);
    } else missing.push('Lease end date missing');
  }
  if(candidate.type==='Finance') {
    const start=record.delivery_date && Date.parse(record.delivery_date+'T12:00:00Z');
    if(Number.isFinite(start) && start<=time(now)) {
      const years=(time(now)-start)/(365.25*DAY);
      if(years>=2 && years<=4.5) add(75+Math.round(Math.min(15,(years-2)*6)),`Finance customer — ${(Math.round(years*10)/10).toFixed(1)} years ownership`);
    } else missing.push('Delivery date missing or invalid — ownership window unavailable');
  }
  if(last===null) add(30,'No contact recorded');
  else if(days>=30) add(Math.min(50,20+Math.floor(days/10)),`No contact in ${days} days`);
  if(!scheduledFuture) add(18,'No future follow-up scheduled');
  if(booked) score-=150;
  else if(scheduledFuture && due<0) score-=50;
  if(days!==null && days<=2) score-=scheduledFuture?100:60;
  reasons.sort((a,b)=>b.points-a.points||a.text.localeCompare(b.text));
  return {...candidate,score,reasons:reasons.map(x=>x.text),missing,priority:score>=125?'Urgent':score>=85?'High':'Medium',lastContact:last,nextDate:next};
}
export function buildCandidates(db,now=Date.now()) {
  const raw=[];
  for(const [type,key] of [['Lead','leads'],['Lease','leases'],['Finance','finance']]) {
    for(const record of db[key]) {
      if(record.archived||record.removed_at||record.closed_at||closed(type==='Lead'?record.status:record.opportunity_status)) continue;
      const customer=db.customers.find(x=>x.id===record.customer_id);
      if(!customer||customer.archived||String(customer.status).toLowerCase()==='do not contact') continue;
      raw.push(scoreCandidate(db,{type,id:record.id,customerId:record.customer_id,vehicle:record.vehicle||'Vehicle not entered',record},now));
    }
  }
  const compare=(a,b)=>b.score-a.score || String(a.customerId).localeCompare(String(b.customerId)) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
  const seen=new Set();
  return raw.sort(compare).filter(x=>{if(x.score<=0||seen.has(x.customerId))return false;seen.add(x.customerId);return true});
}
export function dailySelection(db,limit=10,now=Date.now()) {
  const byCustomer=new Map();
  db.dailyCalls.filter(x=>x.call_date===businessDay(now)).sort((a,b)=>time(a.completed_at)-time(b.completed_at)||a.id.localeCompare(b.id)).forEach(x=>byCustomer.set(x.customer_id,x));
  const completed=[...byCustomer.values()];
  const open=buildCandidates(db,now).filter(x=>!byCustomer.has(x.customerId));
  const target=Math.min(limit,completed.length+open.length);
  return {completed:completed.slice(0,limit),open:open.slice(0,Math.max(0,limit-completed.length)),done:Math.min(limit,completed.length),target,hasMore:completed.length+open.length>limit};
}
