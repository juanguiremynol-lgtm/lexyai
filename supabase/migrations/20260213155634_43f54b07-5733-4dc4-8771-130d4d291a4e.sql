
-- ============================================================================
-- PHASE 2: Courthouse Email State Machine + Audit Table
-- ============================================================================

-- 1. Add state machine columns to work_items
ALTER TABLE public.work_items
ADD COLUMN IF NOT EXISTS courthouse_email_suggested text null,
ADD COLUMN IF NOT EXISTS courthouse_email_confirmed text null,
ADD COLUMN IF NOT EXISTS courthouse_email_status text not null default 'NONE',
ADD COLUMN IF NOT EXISTS courthouse_email_confidence int null,
ADD COLUMN IF NOT EXISTS courthouse_email_source text null,
ADD COLUMN IF NOT EXISTS courthouse_email_evidence jsonb null,
ADD COLUMN IF NOT EXISTS courthouse_email_suggested_at timestamptz null,
ADD COLUMN IF NOT EXISTS courthouse_email_confirmed_at timestamptz null;

-- Add check constraint for valid status values
ALTER TABLE public.work_items
ADD CONSTRAINT courthouse_email_status_check 
CHECK (courthouse_email_status IN ('NONE', 'SUGGESTED', 'CONFIRMED', 'CONFLICT'));

-- 2. Create work_item_email_events audit table
CREATE TABLE IF NOT EXISTS public.work_item_email_events (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  actor_type text not null,
  event_type text not null,
  suggested_email text null,
  confirmed_email text null,
  confidence int null,
  source text null,
  evidence jsonb null,
  created_at timestamptz default now(),
  
  constraint actor_type_check check (actor_type in ('SYSTEM', 'USER', 'ADMIN', 'AI')),
  constraint event_type_check check (event_type in ('SUGGESTED', 'CONFIRMED', 'CLEARED', 'CONFLICT_DETECTED', 'AUTO_UPDATED')),
  constraint confidence_check check (confidence >= 0 and confidence <= 100)
);

-- Create indexes
create index if not exists idx_work_item_email_events_work_item_id on public.work_item_email_events(work_item_id);
create index if not exists idx_work_item_email_events_created_at on public.work_item_email_events(created_at);

-- 3. Enable RLS on work_item_email_events
alter table public.work_item_email_events enable row level security;

-- 4. RLS Policy: Org members can read email events for their work items
create policy "Org members can read email events for their work items"
  on public.work_item_email_events
  for select
  using (
    exists (
      select 1 from public.work_items wi
      where wi.id = work_item_id
        and wi.organization_id = public.get_user_org_id()
    )
  );

-- 5. Trigger to sync work_items status with events
-- When a CONFIRMED event is inserted, update the work_items record
create or replace function public.sync_work_item_email_status_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'CONFIRMED' then
    update work_items
    set courthouse_email_confirmed = new.confirmed_email,
        courthouse_email_status = 'CONFIRMED',
        courthouse_email_confirmed_at = now(),
        updated_at = now()
    where id = new.work_item_id;
  elsif new.event_type = 'SUGGESTED' then
    -- Only update if no confirmed email exists
    update work_items
    set courthouse_email_suggested = new.suggested_email,
        courthouse_email_confidence = new.confidence,
        courthouse_email_source = new.source,
        courthouse_email_evidence = new.evidence,
        courthouse_email_suggested_at = now(),
        courthouse_email_status = case
          when courthouse_email_confirmed is not null then 'CONFIRMED'
          else 'SUGGESTED'
        end,
        updated_at = now()
    where id = new.work_item_id
      and courthouse_email_confirmed is null;
  elsif new.event_type = 'CONFLICT_DETECTED' then
    update work_items
    set courthouse_email_status = 'CONFLICT',
        courthouse_email_evidence = new.evidence,
        updated_at = now()
    where id = new.work_item_id;
  elsif new.event_type = 'CLEARED' then
    update work_items
    set courthouse_email_suggested = null,
        courthouse_email_confirmed = null,
        courthouse_email_status = 'NONE',
        courthouse_email_confidence = null,
        courthouse_email_source = null,
        courthouse_email_evidence = null,
        courthouse_email_suggested_at = null,
        courthouse_email_confirmed_at = null,
        updated_at = now()
    where id = new.work_item_id;
  end if;
  return new;
end;
$$;

-- Trigger on work_item_email_events
drop trigger if exists trg_sync_work_item_email_status on public.work_item_email_events;
create trigger trg_sync_work_item_email_status
  after insert on public.work_item_email_events
  for each row
  execute function public.sync_work_item_email_status_from_event();

-- ============================================================================
-- Indexes for performance
-- ============================================================================
create index if not exists idx_work_items_courthouse_email_status on public.work_items(courthouse_email_status);
create index if not exists idx_work_items_radicado_courthouse_status on public.work_items(radicado, courthouse_email_status) where radicado is not null;
