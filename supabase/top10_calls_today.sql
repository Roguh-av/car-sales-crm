-- Live schema support for the dashboard's Top 10 Calls Today workflow.
-- Applied to Supabase through the authenticated project connection.

alter table public.finance_contracts
  drop constraint finance_contracts_opportunity_status_check,
  add constraint finance_contracts_opportunity_status_check check (opportunity_status in (
    'Not contacted','Interested','Follow-up scheduled','Keeping vehicle','No answer',
    'Left voicemail','Spoke','Sold','Lost','Do Not Contact'
  ));

alter table public.finance_outreach_history
  drop constraint finance_outreach_history_outcome_check,
  add constraint finance_outreach_history_outcome_check check (outcome in (
    'Interested','Follow up later','Keeping vehicle','No answer','Left voicemail','Spoke',
    'Appointment booked','Changing vehicle','Sold','Lost','Do Not Contact'
  ));

alter table public.leases
  drop constraint leases_opportunity_status_check,
  add constraint leases_opportunity_status_check check (opportunity_status in (
    'Not contacted','Interested','Follow-up scheduled','Buying out lease','Returning vehicle',
    'No answer','Left voicemail','Spoke','Not interested','Sold','Lost','Do Not Contact'
  ));

alter table public.lease_outreach_history
  drop constraint lease_outreach_history_outcome_check,
  add constraint lease_outreach_history_outcome_check check (outcome in (
    'Interested in upgrading','Follow up later','Buying out lease','Returning vehicle',
    'No answer','Not interested','Left voicemail','Spoke','Interested','Appointment booked',
    'Keeping vehicle','Changing vehicle','Sold','Lost','Do Not Contact'
  ));

create table public.daily_priority_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  call_date date not null default ((now() at time zone 'America/Toronto')::date),
  customer_id uuid not null references public.customers(id) on delete cascade,
  opportunity_type text not null check (opportunity_type in ('Lead','Lease','Finance')),
  opportunity_id uuid not null,
  vehicle text,
  priority_score integer not null default 0 check (priority_score between -500 and 1000),
  priority_level text not null check (priority_level in ('Urgent','High','Medium')),
  priority_reason text not null,
  result text not null check (result in (
    'No answer','Left voicemail','Spoke','Interested','Appointment booked','Follow up later',
    'Keeping vehicle','Changing vehicle','Sold','Lost','Do Not Contact'
  )),
  notes text,
  next_action_at timestamptz,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, call_date, opportunity_type, opportunity_id)
);

create index daily_priority_calls_owner_date_idx
  on public.daily_priority_calls (owner_id, call_date desc, completed_at);

create index daily_priority_calls_customer_id_idx
  on public.daily_priority_calls (customer_id);

alter table public.daily_priority_calls enable row level security;

create policy daily_priority_calls_owner_all
  on public.daily_priority_calls
  for all
  to authenticated
  using ((select auth.uid()) = owner_id and public.crm_is_approved())
  with check ((select auth.uid()) = owner_id and public.crm_is_approved());

revoke all on table public.daily_priority_calls from anon;
grant select, insert, update on table public.daily_priority_calls to authenticated;
grant select, insert, update, delete on table public.daily_priority_calls to service_role;

create or replace function public.save_finance_outreach(
  p_finance_contract_id uuid,
  p_outcome text,
  p_notes text default null,
  p_next_contact_at timestamptz default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_customer_id uuid;
  v_followup_id uuid;
  v_history_id uuid;
  v_status text;
  v_closed boolean := p_outcome in ('Keeping vehicle','Sold','Lost','Do Not Contact');
begin
  if p_outcome not in (
    'Interested','Follow up later','Keeping vehicle','No answer','Left voicemail','Spoke',
    'Appointment booked','Changing vehicle','Sold','Lost','Do Not Contact'
  ) then raise exception 'Invalid finance outreach outcome'; end if;

  if p_outcome in ('Follow up later','No answer') and p_next_contact_at is null then
    raise exception 'Choose the next call date and time';
  end if;

  select fc.owner_id,fc.customer_id into v_owner_id,v_customer_id
  from public.finance_contracts fc
  where fc.id=p_finance_contract_id
    and fc.owner_id=(select auth.uid())
    and public.crm_is_approved();

  if v_owner_id is null then raise exception 'Finance contract not found or access denied'; end if;

  update public.followups set status='Done'
  where owner_id=v_owner_id and finance_contract_id=p_finance_contract_id and status<>'Done'
    and (scheduled_at<=now() or v_closed);

  if p_next_contact_at is not null and not v_closed then
    insert into public.followups(owner_id,customer_id,finance_contract_id,action_type,scheduled_at,status,notes)
    values(v_owner_id,v_customer_id,p_finance_contract_id,
      case when p_outcome='Appointment booked' then 'Appointment' else 'Finance follow-up' end,
      p_next_contact_at,'Open',concat(p_outcome,case when nullif(btrim(p_notes),'') is not null then ': '||btrim(p_notes) else '' end))
    returning id into v_followup_id;
  end if;

  v_status := case
    when p_outcome in ('Interested','Changing vehicle','Appointment booked') then 'Interested'
    when p_outcome in ('Follow up later','Left voicemail','Spoke') and p_next_contact_at is not null then 'Follow-up scheduled'
    else p_outcome
  end;

  update public.finance_contracts
  set opportunity_status=v_status,last_contact_at=now(),
      next_contact_at=case when v_closed then null else p_next_contact_at end,
      last_contact_notes=nullif(btrim(p_notes),''),
      closed_at=case when v_closed then now() else null end,updated_at=now()
  where id=p_finance_contract_id and owner_id=v_owner_id;

  insert into public.finance_outreach_history(owner_id,finance_contract_id,customer_id,outcome,notes,next_contact_at,followup_id)
  values(v_owner_id,p_finance_contract_id,v_customer_id,p_outcome,nullif(btrim(p_notes),''),case when v_closed then null else p_next_contact_at end,v_followup_id)
  returning id into v_history_id;

  return v_history_id;
end;
$$;

create or replace function public.save_lease_outreach(
  p_lease_contract_id uuid,
  p_outcome text,
  p_notes text default null,
  p_next_contact_at timestamptz default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_customer_id uuid;
  v_followup_id uuid;
  v_history_id uuid;
  v_status text;
  v_closed boolean := p_outcome in ('Not interested','Sold','Lost','Do Not Contact');
begin
  if p_outcome not in (
    'Interested in upgrading','Follow up later','Buying out lease','Returning vehicle','No answer','Not interested',
    'Left voicemail','Spoke','Interested','Appointment booked','Keeping vehicle','Changing vehicle','Sold','Lost','Do Not Contact'
  ) then raise exception 'Invalid lease outreach outcome'; end if;

  if p_outcome in ('Follow up later','No answer') and p_next_contact_at is null then
    raise exception 'A next call date is required for this outcome';
  end if;

  select l.owner_id,l.customer_id into v_owner_id,v_customer_id
  from public.leases l
  where l.id=p_lease_contract_id
    and l.owner_id=(select auth.uid())
    and public.crm_is_approved();

  if v_owner_id is null then raise exception 'Lease contract not found or access denied'; end if;

  update public.followups set status='Done'
  where lease_contract_id=p_lease_contract_id and owner_id=v_owner_id and status<>'Done'
    and (scheduled_at<=now() or v_closed);

  if p_next_contact_at is not null and not v_closed then
    insert into public.followups(owner_id,customer_id,lease_contract_id,action_type,scheduled_at,status,notes)
    values(v_owner_id,v_customer_id,p_lease_contract_id,
      case when p_outcome='Appointment booked' then 'Appointment' else 'Lease follow-up' end,
      p_next_contact_at,'Open',concat(p_outcome,case when nullif(btrim(p_notes),'') is not null then ': '||btrim(p_notes) else '' end))
    returning id into v_followup_id;
  end if;

  v_status := case
    when p_outcome in ('Interested in upgrading','Interested','Changing vehicle','Appointment booked') then 'Interested'
    when p_outcome in ('Follow up later','Left voicemail','Spoke') and p_next_contact_at is not null then 'Follow-up scheduled'
    when p_outcome='Keeping vehicle' then 'Buying out lease'
    else p_outcome
  end;

  update public.leases
  set opportunity_status=v_status,last_contact_at=now(),
      next_contact_at=case when v_closed then null else p_next_contact_at end,
      last_contact_notes=nullif(btrim(p_notes),''),
      closed_at=case when v_closed then now() else null end
  where id=p_lease_contract_id and owner_id=v_owner_id;

  insert into public.lease_outreach_history(owner_id,lease_contract_id,customer_id,outcome,notes,next_contact_at,followup_id)
  values(v_owner_id,p_lease_contract_id,v_customer_id,p_outcome,nullif(btrim(p_notes),''),case when v_closed then null else p_next_contact_at end,v_followup_id)
  returning id into v_history_id;

  return v_history_id;
end;
$$;

create or replace function public.save_priority_call_result(
  p_opportunity_type text,
  p_opportunity_id uuid,
  p_result text,
  p_notes text default null,
  p_next_action_at timestamptz default null,
  p_priority_score integer default 0,
  p_priority_reason text default 'Priority opportunity'
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_customer_id uuid;
  v_vehicle text;
  v_daily_id uuid;
  v_level text;
  v_action_type text;
  v_closed boolean := p_result in ('Keeping vehicle','Sold','Lost','Do Not Contact');
begin
  if v_owner_id is null or not public.crm_is_approved() then raise exception 'Access denied'; end if;
  if p_opportunity_type not in ('Lead','Lease','Finance') then raise exception 'Invalid opportunity type'; end if;
  if p_result not in ('No answer','Left voicemail','Spoke','Interested','Appointment booked','Follow up later','Keeping vehicle','Changing vehicle','Sold','Lost','Do Not Contact') then raise exception 'Invalid call result'; end if;
  if p_result in ('No answer','Left voicemail','Spoke','Interested','Appointment booked','Follow up later','Changing vehicle') and p_next_action_at is null then raise exception 'Choose the next action date and time'; end if;
  if p_priority_score not between -500 and 1000 then raise exception 'Invalid priority score'; end if;

  if p_opportunity_type='Finance' then
    select owner_id,customer_id,vehicle into v_owner_id,v_customer_id,v_vehicle
    from public.finance_contracts where id=p_opportunity_id and owner_id=(select auth.uid());
    if v_customer_id is null then raise exception 'Finance opportunity not found'; end if;
    perform public.save_finance_outreach(p_opportunity_id,p_result,p_notes,p_next_action_at);
  elsif p_opportunity_type='Lease' then
    select owner_id,customer_id,vehicle into v_owner_id,v_customer_id,v_vehicle
    from public.leases where id=p_opportunity_id and owner_id=(select auth.uid());
    if v_customer_id is null then raise exception 'Lease opportunity not found'; end if;
    perform public.save_lease_outreach(p_opportunity_id,p_result,p_notes,p_next_action_at);
  else
    select owner_id,customer_id,vehicle into v_owner_id,v_customer_id,v_vehicle
    from public.leads where id=p_opportunity_id and owner_id=(select auth.uid()) and not archived and status not in ('Sold','Lost');
    if v_customer_id is null then raise exception 'Lead opportunity not found or already closed'; end if;

    update public.followups set status='Done'
    where owner_id=v_owner_id and lead_id=p_opportunity_id and status<>'Done'
      and (scheduled_at<=now() or v_closed);

    if p_next_action_at is not null and not v_closed then
      v_action_type:=case when p_result='Appointment booked' then 'Appointment' else 'Call' end;
      insert into public.followups(owner_id,customer_id,lead_id,action_type,scheduled_at,status,notes)
      values(v_owner_id,v_customer_id,p_opportunity_id,v_action_type,p_next_action_at,'Open',concat(p_result,case when nullif(btrim(p_notes),'') is not null then ': '||btrim(p_notes) else '' end));
    end if;

    update public.leads
    set status=case
          when p_result='Appointment booked' then 'Appointment'
          when p_result='Sold' then 'Sold'
          when p_result in ('Keeping vehicle','Lost','Do Not Contact') then 'Lost'
          when p_result in ('Spoke','Interested','Changing vehicle','Follow up later') and status='New' then 'Contacted'
          else status end,
        next_action_at=case when v_closed then null else p_next_action_at end,
        sold_at=case when p_result='Sold' then now() else sold_at end,
        lost_reason=case when p_result in ('Keeping vehicle','Lost','Do Not Contact') then p_result else lost_reason end,
        updated_at=now()
    where id=p_opportunity_id and owner_id=v_owner_id;

    insert into public.lead_history(owner_id,lead_id,event_type,note)
    values(v_owner_id,p_opportunity_id,'Priority call',concat(p_result,case when nullif(btrim(p_notes),'') is not null then ': '||btrim(p_notes) else '' end));
  end if;

  if p_result='Do Not Contact' then
    update public.customers set status='Do Not Contact',updated_at=now()
    where id=v_customer_id and owner_id=v_owner_id;
  end if;

  v_level:=case when p_priority_score>=125 then 'Urgent' when p_priority_score>=85 then 'High' else 'Medium' end;

  insert into public.daily_priority_calls(
    owner_id,call_date,customer_id,opportunity_type,opportunity_id,vehicle,
    priority_score,priority_level,priority_reason,result,notes,next_action_at,completed_at,updated_at
  ) values (
    v_owner_id,(now() at time zone 'America/Toronto')::date,v_customer_id,p_opportunity_type,p_opportunity_id,v_vehicle,
    p_priority_score,v_level,left(coalesce(nullif(btrim(p_priority_reason),''),'Priority opportunity'),500),p_result,
    nullif(btrim(p_notes),''),case when v_closed then null else p_next_action_at end,now(),now()
  )
  on conflict (owner_id,call_date,opportunity_type,opportunity_id)
  do update set priority_score=excluded.priority_score,priority_level=excluded.priority_level,
    priority_reason=excluded.priority_reason,result=excluded.result,notes=excluded.notes,
    next_action_at=excluded.next_action_at,completed_at=now(),updated_at=now()
  returning id into v_daily_id;

  return v_daily_id;
end;
$$;

revoke execute on function public.save_priority_call_result(text,uuid,text,text,timestamptz,integer,text) from public,anon;
grant execute on function public.save_priority_call_result(text,uuid,text,text,timestamptz,integer,text) to authenticated,service_role;

revoke execute on function public.save_finance_outreach(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.save_finance_outreach(uuid,text,text,timestamptz) to authenticated,service_role;

revoke execute on function public.save_lease_outreach(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.save_lease_outreach(uuid,text,text,timestamptz) to authenticated,service_role;
