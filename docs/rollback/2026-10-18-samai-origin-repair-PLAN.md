# SAMAI origin-contamination repair — PLAN ONLY (not executed)

Status: awaiting owner approval. Nothing below has been run.

## Scope (read-only census, 2026-10-18)
SAMAI acts whose protected `description` names solicitud X while
`raw_data.anotacion` / `event_summary` name solicitud Y:

| act id | work_item | description | anotación/summary | Y has own row |
|---|---|---|---|---|
| eb26e63c-9284-4e60-abe5-835a944c7f47 | 2a590db7… | 3122409 | 3122109 | no |
| afc43437-37e7-407a-ac64-87355b0dae7d | 2a590db7… | 3223409 | 3223197 | no |
| 26436831-aff4-455d-95ca-5fb355429fa3 | caf1442f… | 3330330 | 3330259 | no |
| f148bbab-4723-42e2-853f-819571f2b8ed | 8fac310f… | 3435550 | 3432736 | no |

So 4 rows are contaminated and 4 memoriales (Y) are missing as their own acts.

## Two repair routes (choose one)

### Route 1 — let the corrected sync heal (preferred)
After deploying `sync-by-work-item` (rev.2), the next sync of each matter:
- matches X by origin equivalence, restores `raw_data.anotacion` + `event_summary`
  to X's text, keeps the previous value in `raw_data.anotacion_reparada.anterior`;
- inserts Y as a new act with fingerprint `<v1>_o<hash>`.
Note: this only works while the provider still serves both X and Y in its feed
(verified for f148bbab on 2026-10-18). Inserting Y can produce a normal novedad
for Y (it is genuinely new to Andromeda).

### Route 2 — manual SQL (only if Route 1 cannot reach a row)
1. Backup
```sql
create table if not exists public._iter70_samai_origin_backup as
select now() as backed_up_at, a.* from public.work_item_acts a
where a.id in ('eb26e63c-9284-4e60-abe5-835a944c7f47','afc43437-37e7-407a-ac64-87355b0dae7d',
               '26436831-aff4-455d-95ca-5fb355429fa3','f148bbab-4723-42e2-853f-819571f2b8ed');
alter table public._iter70_samai_origin_backup enable row level security; -- service-role only
```
2. Repair (raw_data.anotacion and event_summary from the protected description tail)
```sql
update public.work_item_acts a set
  raw_data = a.raw_data
    || jsonb_build_object('anotacion', split_part(a.description, ' - ', 2) || coalesce(nullif(substr(a.description, length(split_part(a.description,' - ',1)||' - '||split_part(a.description,' - ',2))+1),''),''),
                          'anotacion_reparada', jsonb_build_object('en', now(), 'anterior', a.raw_data->>'anotacion', 'motivo', 'anotacion_de_otro_origen')),
  event_summary = left(a.description, 500),
  updated_at = now()
where a.id in (select id from public._iter70_samai_origin_backup);
```
(The anotación is everything after the first " - " of the description; the
expression above keeps any further " - " segments.)
3. Validation (must return 0 rows)
```sql
select id from public.work_item_acts
where id in (select id from public._iter70_samai_origin_backup)
  and (regexp_match(description,'solicitud\s+No\.?\s*(\d{4,})','i'))[1]
      is distinct from (regexp_match(raw_data->>'anotacion','solicitud\s+No\.?\s*(\d{4,})','i'))[1];
```
4. Rollback
```sql
update public.work_item_acts a set raw_data = b.raw_data, event_summary = b.event_summary, updated_at = now()
from public._iter70_samai_origin_backup b where a.id = b.id;
```
Missing Y acts are NOT created by SQL — they come from the provider via sync.

## Alert 3b5d9a80 (title "Medida cautelar ordenada")
Optional retitle to "Actuación relacionada con medida cautelar" with the old
title saved in payload; separate approval.

## Rev.3 (2026-10-18) — repair is gated
- Normal sync NEVER repairs contaminated history: `HISTORICAL_REPAIR_SCOPE = null` in sync-by-work-item.
- Ruta 1 now requires an explicit, approved change setting `{ provider: "samai", approvedActIds: {eb26e63c…, afc43437…, 26436831…, f148bbab…} }`, deployed only AFTER the backup table `_iter70_samai_origin_backup` is created and validated, then reverted to `null`.
- Ruta 2 (SQL) unchanged. Neither route has been executed.

## Rev.4 (2026-10-18) — isolated integration finding (BLOCKS publication)
Local run of the real function + real RPC + production schema (schema-only, synthetic data):
- Two solicitudes on the same day/title: identity resolution correctly decides INSERT for B
  (versioned fingerprint), but the RPC skips it as SKIPPED_DUPLICATE_STRUCTURAL because of the
  unique index `idx_acts_dedupe_structural` (work_item_id, normalized title, act_date, party, recurso).
  Only 1 of 2 rows persists; the response reports skipped, not error.
- Consequence for publication: deploying the sync fix does NOT create the 4 missing solicitudes
  (3122109, 3223197, 3330259, 3432736) and does NOT emit novedades for them. Ruta 1 ("heal on next
  sync") is invalid as written. Creating them requires a schema change to that index (e.g. adding
  the origin key to it), which is a migration needing separate approval and backup.
- Expected effect once that index is changed: each previously omitted solicitud is inserted as a new
  act and emits normal novedades (notifications row via notify_new_actuacion, possible alerts),
  even with historical text repair disabled.
- Scenarios after S1 in that run were invalid (PostgREST schema cache not reloaded after DB reset);
  they must be re-run after fixing the harness wait. Not yet verified: repeat batch, indice later,
  in-batch enrichment, write/read-back failure with rollback, pagination >1000, no-repair of history.
