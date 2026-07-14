# Memory: governance/westados-truncation-wont-fix
Updated: 2026-07-14

## Status: WON'T FIX (portal limitation, zero user impact)

## Symptom

~49 rows in the WEstados feed appear truncated (partial titles / missing fields) compared to their gemelas in `samai_actuaciones` / expediente records.

## Diagnosis

1. **Root cause is upstream**: the Consejo de Estado portal itself exposes truncated data on the WEstados endpoint. Nothing on the ATENIA side is dropping fields.
2. **Exposure is 0**: each of the 49 truncated rows has a complete gemela in `samai_actuaciones` for the same expediente, and the UI's `feedCombinado` preference logic already picks the expediente version — so users never see the truncated string.
3. **Confirmed via terrain check on 2026-07-14** (Cloud Run diagnosis + Supabase-side twin verification).

## Decision

- Do not attempt a workaround (parsing fallbacks, PDF re-fetch, secondary endpoints). Any fix would add complexity for zero user benefit.
- If a future audit re-opens this, point them to this memory and to the terrain report — do not spend cycles re-diagnosing.

## Related

- The other two items from the 2026-07-14 report are resolved: `.zip Bogotá 042` (fixed GCP-side, contract live end-to-end) and `PP→work_item_acts contamination` (see `pp-write-guard-and-estados-actuaciones-separation`).