# Memory: governance/pp-write-guard-and-estados-actuaciones-separation
Updated: 2026-07-14

## Absolute Rule (Doctor-confirmed 2026-07-14)

- **ACTUACIONES = CPNU, SAMAI, Tutelas exclusively.**
- **ESTADOS/Publicaciones = PP + SAMAI_ESTADOS.**
- PP MUST NEVER write into `work_item_acts` under any condition — not even with "clean" descriptions. PP data flows into `work_item_publicaciones` via `sync-publicaciones-by-work-item`.

## Enforcement (in production)

1. **Code path removed** — `supabase/functions/sync-pp-by-work-item/index.ts` is a deprecated no-op stub. It still registers `pp_id` best-effort and sets `pp_estado='deprecated'`, but writes zero rows to `work_item_acts`. The daily scheduler (`scheduled-daily-sync`) no longer invokes it.
2. **Structural guard** — trigger `trg_reject_estados_family_in_work_item_acts` (BEFORE INSERT on `work_item_acts`) raises `check_violation` when `source` or `source_platform` is `pp` or `publicaciones` (case-insensitive). Any code re-introducing PP→acts writes fails loudly.
3. **Historical cleanup** — the 7 PP-misrouted rows on work items `27db2525-f5a4-4a3d-abdc-9ca465b1aa72` and `f8eaae6a-fae5-48e2-9660-101e099838a7` were soft-deleted with `is_archived=true`, `archived_reason='PP_MISROUTED_TO_ACTS'` on 2026-07-14. No FK, notification, or alert dependencies were affected (verified: 0 rows in `act_provenance`, `alert_instances`, `work_item_act_extras`).

## SAMAI_ESTADOS — Open Item

`provider-sync-external-provider/index.ts` still writes `source='samai_estados'` into `work_item_acts` (12 legacy rows exist on 3 work items; 10 have twins in `work_item_publicaciones`, 2 do not). This is the same misroute class as PP. The guard trigger intentionally does NOT block `samai_estados` yet — awaiting Doctor's decision before extending the block and archiving. When approved, add `samai_estados` to the reject list in `reject_estados_family_in_work_item_acts()`.

## Do Not

- Do not add "quality-enhancement" heuristics to make PP acts writes acceptable — the correct answer is always "don't write".
- Do not dual-write PP data into both `work_item_publicaciones` and `work_item_acts`; publicaciones is the single canonical destination.