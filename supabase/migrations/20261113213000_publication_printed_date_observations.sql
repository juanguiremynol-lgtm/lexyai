-- Documentary observations are separate from provider rows, events and deadlines.
create table public.publication_printed_date_observations (
  publication_id uuid not null references public.work_item_publicaciones(id) on delete restrict,
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  source_url text not null check (
    source_url ~ '^https://storage[.]googleapis[.]com/andromeda-pp-documentos-2026/[0-9]{23}/raw/estados/[A-Za-z0-9_.-]+[.]pdf$'
  ),
  source_article text not null check (source_article ~ '^[0-9]{1,30}$'),
  first_page integer not null check (first_page > 0),
  last_page integer not null check (last_page >= first_page),
  recorded_fixation date not null,
  printed_fixation date not null check (printed_fixation <> recorded_fixation),
  observed_at timestamptz not null default now(),
  primary key (publication_id, original_sha256, first_page, last_page)
);

alter table public.publication_printed_date_observations enable row level security;
revoke all on public.publication_printed_date_observations from public, anon, authenticated, service_role;
grant select on public.publication_printed_date_observations to authenticated, service_role;
create policy read_parent_publication_evidence on public.publication_printed_date_observations
  for select to authenticated using (
    exists (select 1 from public.work_item_publicaciones pub
             where pub.id = publication_id and pub.is_archived is not true)
  );
comment on table public.publication_printed_date_observations is
  'Archived PDF readings. Neither a new provider event nor a change to a deadline or its legal anchor.';
notify pgrst, 'reload schema';
