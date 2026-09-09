-- Additive only: retain existing records and leave unknown historical timestamps null.
alter table public.followups add column if not exists completed_at timestamptz;
alter table public.followups add column if not exists cancelled_at timestamptz;
alter table public.followups add column if not exists cancellation_reason text;

create table if not exists public.customer_activity (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  customer_id uuid not null references public.customers(id),
  kind text not null,
  note text,
  occurred_at timestamptz not null default now(),
  source_table text,
  source_id uuid
);
alter table public.customer_activity enable row level security;
revoke all on public.customer_activity from anon,authenticated;
grant select,insert on public.customer_activity to authenticated;
create policy customer_activity_read on public.customer_activity for select to authenticated
  using (owner_id=(select auth.uid()) and public.crm_is_approved());
create policy customer_activity_add on public.customer_activity for insert to authenticated
  with check (owner_id=(select auth.uid()) and public.crm_is_approved() and exists
    (select 1 from public.customers c where c.id=customer_id and c.owner_id=(select auth.uid())));
create index customer_activity_owner_customer_time on public.customer_activity(owner_id,customer_id,occurred_at desc);

create or replace function public.crm_followup_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.customers c where c.id=new.customer_id and c.owner_id=new.owner_id) then
    raise exception 'Customer not found or access denied';
  end if;
  if new.lead_id is not null and not exists(select 1 from public.leads l where l.id=new.lead_id and l.customer_id=new.customer_id and l.owner_id=new.owner_id) then raise exception 'Action and lead must belong to the same customer'; end if;
  if new.finance_contract_id is not null and not exists(select 1 from public.finance_contracts f where f.id=new.finance_contract_id and f.customer_id=new.customer_id and f.owner_id=new.owner_id) then raise exception 'Action and finance contract must belong to the same customer'; end if;
  if new.lease_contract_id is not null and not exists(select 1 from public.leases l where l.id=new.lease_contract_id and l.customer_id=new.customer_id and l.owner_id=new.owner_id and (l.removed_at is null or new.cancelled_at is not null)) then raise exception 'Lease has been removed or belongs to another customer'; end if;
  if new.delivery_id is not null and not exists(select 1 from public.deliveries d where d.id=new.delivery_id and d.customer_id=new.customer_id and d.owner_id=new.owner_id) then raise exception 'Action and delivery must belong to the same customer'; end if;
  if new.cancelled_at is not null then new.status:='Cancelled'; end if;
  if new.status='Done' and (tg_op='INSERT' or old.status is distinct from 'Done') then new.completed_at:=now();
  elsif new.status<>'Done' then new.completed_at:=null; end if;
  return new;
end $$;
create trigger crm_followup_guard before insert or update on public.followups for each row execute function public.crm_followup_guard();

create or replace function public.crm_followup_sync_history() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.followups; v_kind text; v_note text; v_id uuid;
begin
  if tg_op='DELETE' then r:=old; else r:=new; end if;
  -- Recompute the earliest remaining action, including both links if an action moves.
  for v_id in select distinct id from unnest(array[r.lead_id,case when tg_op='UPDATE' then old.lead_id end]) id where id is not null loop
    update public.leads set next_action_at=(select min(scheduled_at) from public.followups where lead_id=v_id and owner_id=r.owner_id and status='Open' and cancelled_at is null) where id=v_id and owner_id=r.owner_id;
  end loop;
  for v_id in select distinct id from unnest(array[r.finance_contract_id,case when tg_op='UPDATE' then old.finance_contract_id end]) id where id is not null loop
    update public.finance_contracts set next_contact_at=(select min(scheduled_at) from public.followups where finance_contract_id=v_id and owner_id=r.owner_id and status='Open' and cancelled_at is null) where id=v_id and owner_id=r.owner_id;
  end loop;
  for v_id in select distinct id from unnest(array[r.lease_contract_id,case when tg_op='UPDATE' then old.lease_contract_id end]) id where id is not null loop
    update public.leases set next_contact_at=(select min(scheduled_at) from public.followups where lease_contract_id=v_id and owner_id=r.owner_id and status='Open' and cancelled_at is null) where id=v_id and owner_id=r.owner_id;
  end loop;
  v_kind:=case when tg_op='INSERT' then 'Action scheduled' when tg_op='DELETE' then 'Action deleted' when new.cancelled_at is not null then 'Action cancelled' when new.status='Done' and old.status is distinct from 'Done' then 'Action completed' when new.status='Missed' then 'Appointment missed' else 'Action updated' end;
  v_note:=concat(r.action_type,' · scheduled ',r.scheduled_at,' · ',r.status,case when tg_op='UPDATE' and old.scheduled_at is distinct from new.scheduled_at then concat(' · previously ',old.scheduled_at) else '' end,case when r.notes is not null then ' · '||r.notes else '' end,case when r.cancellation_reason is not null then ' · '||r.cancellation_reason else '' end);
  insert into public.customer_activity(owner_id,customer_id,kind,note,source_table,source_id) values(r.owner_id,r.customer_id,v_kind,v_note,'followups',r.id);
  return null;
end $$;
create trigger crm_followup_sync_history after insert or update or delete on public.followups for each row execute function public.crm_followup_sync_history();

create or replace function public.crm_lead_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.lead_history(owner_id,lead_id,event_type,note) values(new.owner_id,new.id,'Lead created',new.notes);
  else
    if old.status is distinct from new.status then insert into public.lead_history(owner_id,lead_id,event_type,note) values(new.owner_id,new.id,'Status changed',concat(old.status,' → ',new.status)); end if;
    if old.priority is distinct from new.priority then insert into public.lead_history(owner_id,lead_id,event_type,note) values(new.owner_id,new.id,'Priority changed',concat(old.priority,' → ',new.priority)); end if;
    if old.vehicle is distinct from new.vehicle then insert into public.lead_history(owner_id,lead_id,event_type,note) values(new.owner_id,new.id,'Vehicle interest',new.vehicle); end if;
  end if;
  if new.status in ('Sold','Lost','Do Not Contact') then
    update public.followups set cancelled_at=now(),cancellation_reason='Lead closed: '||new.status
    where lead_id=new.id and owner_id=new.owner_id and status='Open' and cancelled_at is null and delivery_id is null;
  end if;
  return null;
end $$;
create trigger crm_lead_history after insert or update of status,priority,vehicle on public.leads for each row execute function public.crm_lead_history();

create or replace function public.crm_delivery_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  insert into public.customer_activity(owner_id,customer_id,kind,note,source_table,source_id)
  values(new.owner_id,new.customer_id,case when tg_op='INSERT' then 'Delivery scheduled' else 'Delivery updated' end,concat(new.vehicle,' · ',new.status,' · ',new.delivery_at),'deliveries',new.id);
  return null;
end $$;
create trigger crm_delivery_history after insert or update of status,delivery_at,notes on public.deliveries for each row execute function public.crm_delivery_history();

create or replace function public.crm_customer_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.notes is distinct from new.notes then insert into public.customer_activity(owner_id,customer_id,kind,note,source_table,source_id) values(new.owner_id,new.id,'Customer notes updated',new.notes,'customers',new.id); end if;
  if old.status is distinct from new.status then insert into public.customer_activity(owner_id,customer_id,kind,note,source_table,source_id) values(new.owner_id,new.id,'Customer status changed',concat(old.status,' → ',new.status),'customers',new.id); end if;
  if new.status='Do Not Contact' or new.archived then
    update public.followups set cancelled_at=now(),cancellation_reason='Customer unavailable for contact'
    where customer_id=new.id and owner_id=new.owner_id and status='Open' and cancelled_at is null;
  end if;
  return null;
end $$;
create trigger crm_customer_history after update of notes,status,archived on public.customers for each row execute function public.crm_customer_history();

create or replace function public.remove_lease_opportunity(p_lease_contract_id uuid,p_reason text default 'Assigned to another salesperson') returns void language plpgsql security invoker set search_path='' as $$
declare v_lease public.leases;
begin
  if auth.uid() is null or not public.crm_is_approved() then raise exception 'Not authorized'; end if;
  select * into v_lease from public.leases where id=p_lease_contract_id and owner_id=auth.uid() and removed_at is null for update;
  if not found then raise exception 'Lease opportunity not found or already removed'; end if;
  update public.followups set cancelled_at=now(),cancellation_reason='Lease removed from active list' where owner_id=auth.uid() and lease_contract_id=p_lease_contract_id and status not in ('Done','Cancelled') and cancelled_at is null;
  update public.leases set removed_at=now(),removal_reason=coalesce(nullif(trim(p_reason),''),'No reason provided'),next_contact_at=null,closed_at=coalesce(closed_at,now()) where id=v_lease.id;
  insert into public.customer_activity(owner_id,customer_id,kind,note,source_table,source_id) values(v_lease.owner_id,v_lease.customer_id,'Lease removed from active list',concat(v_lease.vehicle,' · ',p_reason),'leases',v_lease.id);
  -- Customer, lease, outreach, reminders and daily completion records are retained.
end $$;

revoke all on function public.crm_followup_guard(),public.crm_followup_sync_history(),public.crm_lead_history(),public.crm_delivery_history() from public,anon,authenticated;
revoke all on function public.crm_customer_history() from public,anon,authenticated;
revoke all on function public.remove_lease_opportunity(uuid,text) from public,anon;
grant execute on function public.remove_lease_opportunity(uuid,text) to authenticated;
