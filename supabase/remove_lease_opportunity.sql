-- Soft-remove a lease opportunity without deleting the customer or outreach history.
alter table public.leases
  add column if not exists removed_at timestamptz,
  add column if not exists removal_reason text;

create index if not exists leases_owner_active_idx
  on public.leases (owner_id, lease_end_date)
  where removed_at is null;

create or replace function public.remove_lease_opportunity(
  p_lease_contract_id uuid,
  p_reason text default 'Assigned to another salesperson'
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null or not public.crm_is_approved() then
    raise exception 'Not authorized';
  end if;

  select owner_id
    into v_owner_id
    from public.leases
   where id = p_lease_contract_id
     and removed_at is null
   for update;

  if not found then
    raise exception 'Lease opportunity not found';
  end if;

  if v_owner_id <> auth.uid() then
    raise exception 'Not authorized';
  end if;

  delete from public.followups
   where owner_id = auth.uid()
     and lease_contract_id = p_lease_contract_id
     and status <> 'Done';

  update public.leases
     set removed_at = now(),
         removal_reason = coalesce(nullif(trim(p_reason), ''), 'No reason provided'),
         next_contact_at = null,
         closed_at = coalesce(closed_at, now())
   where id = p_lease_contract_id
     and owner_id = auth.uid();

  delete from public.daily_priority_calls
   where owner_id = auth.uid()
     and opportunity_type = 'Lease'
     and opportunity_id = p_lease_contract_id;
end;
$$;

revoke all on function public.remove_lease_opportunity(uuid, text) from public, anon;
grant execute on function public.remove_lease_opportunity(uuid, text) to authenticated, service_role;
