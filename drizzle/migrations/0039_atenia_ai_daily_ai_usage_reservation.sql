-- Reserva atómica de enriquecimiento IA: máximo 1 llamada automática por org/día Bogotá/caller.
create table if not exists public.atenia_ai_daily_ai_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  usage_date date not null,
  caller text not null,
  reserved_at timestamptz not null default now(),
  outcome text,
  input_tokens integer,
  output_tokens integer,
  unique (organization_id, usage_date, caller)
);

alter table public.atenia_ai_daily_ai_usage enable row level security;
revoke all on public.atenia_ai_daily_ai_usage from anon, authenticated;
grant select, insert, update on public.atenia_ai_daily_ai_usage to service_role;

-- Devuelve el id de la reserva si esta corrida la obtuvo; null si ya existía.
create or replace function public.atenia_ai_reserve_daily_ai(
  _org_id uuid,
  _usage_date date,
  _caller text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.atenia_ai_daily_ai_usage (organization_id, usage_date, caller)
  values (_org_id, _usage_date, _caller)
  on conflict (organization_id, usage_date, caller) do nothing
  returning id
$$;

revoke all on function public.atenia_ai_reserve_daily_ai(uuid, date, text) from public, anon, authenticated;
grant execute on function public.atenia_ai_reserve_daily_ai(uuid, date, text) to service_role;