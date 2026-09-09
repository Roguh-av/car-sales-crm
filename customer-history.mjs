// Merge existing sources; do not copy customers or opportunities into a new system.
export function customerTimeline(db,customerId){
  const items=[];
  const add=(key,at,title,note)=>{if(at)items.push({key,at,title,note:note||''})};
  const customer=db.customers.find(x=>x.id===customerId);
  if(!customer)return items;
  add('customer:'+customer.id,customer.created_at,'Customer record created','');
  const leads=db.leads.filter(x=>x.customer_id===customerId),ids=new Set(leads.map(x=>x.id));
  db.history.filter(x=>ids.has(x.lead_id)).forEach(x=>{
    const lead=leads.find(l=>l.id===x.lead_id);
    const type=['Call','Appointment','Text','Email'].includes(x.event_type)?`${x.event_type} entry (legacy scheduling record)`:x.event_type;
    add('lead-history:'+x.id,x.occurred_at,`${type} · ${lead.vehicle||'Lead'}`,x.note);
  });
  for(const [key,label] of [['outreach','Finance'],['leaseOutreach','Lease']])db[key].filter(x=>x.customer_id===customerId).forEach(x=>add(key+':'+x.id,x.created_at,`${label} call · ${x.outcome}`,x.notes));
  const activity=db.activity.filter(x=>x.customer_id===customerId);
  activity.forEach(x=>add('activity:'+x.id,x.occurred_at,x.kind,x.note));
  const captured=new Set(activity.map(x=>x.source_table+':'+x.source_id));
  (db.allFollowups||db.followups).filter(x=>x.customer_id===customerId&&!captured.has('followups:'+x.id)).forEach(x=>{
    add('followup:'+x.id,x.created_at,`${x.action_type} scheduled`,`${x.scheduled_at||'Date not recorded'} · ${x.status}${x.notes?' · '+x.notes:''}`);
    if(x.completed_at)add('completed:'+x.id,x.completed_at,`${x.action_type} completed`,x.notes);
  });
  db.deliveries.filter(x=>x.customer_id===customerId&&!captured.has('deliveries:'+x.id)).forEach(x=>add('delivery:'+x.id,x.created_at,'Delivery record',`${x.vehicle||''} · current status: ${x.status} · scheduled ${x.delivery_at||'date not recorded'}`));
  db.orders.filter(x=>x.customer_id===customerId).forEach(x=>add('order:'+x.id,x.created_at,'Vehicle order created',`${x.vehicle||''} · current status: ${x.status}`));
  for(const [key,label] of [['leases','Lease'],['finance','Finance']])db[key].filter(x=>x.customer_id===customerId).forEach(x=>add(key+':'+x.id,x.created_at,`${label} record added`,`${x.vehicle||''}${x.removed_at?' · removed from active list':''}`));
  return items.sort((a,b)=>new Date(b.at)-new Date(a.at)||a.key.localeCompare(b.key));
}
