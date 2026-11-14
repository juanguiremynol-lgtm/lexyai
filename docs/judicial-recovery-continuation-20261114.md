# Judicial recovery continuation — 2026-11-14

Baseline and rollback point: `0cc6c674770b48bfd4efd1813d81586f7c93f9c5`.

## Executed changes

- Applied `drizzle/migrations/0103_stale_daily_admission_recovery.sql` to the existing database. An acts `STARTED` admission older than 15 minutes is changed to `FAILED / DAILY_ADMISSION_STALE_RECOVERED` under the cycle row lock only when there is no currently bound `IN_PROGRESS` CPNU job. The old token is removed, so a late worker cannot seal the recovered cycle. The result is still a duplicate admission: only a certified stored read may continue; no new daily extraction is admitted. Existing execution ACLs were read back unchanged (`service_role` and the managed execution role only).
- Deployed only `process-retry-queue`. Act retries now reach the callee's fenced stored-read continuation instead of being suppressed by the publication duplicate precheck. Publication retries still defer to their durable monitor and cannot create a second PP POST.
- The same deployed function now classifies a source-complete/persistence-complete response whose only remaining effect is an unverified hearing handoff as `INELIGIBLE / HEARING_DOCUMENT_REVIEW_REQUIRED`. This stops identical retries without closing the hearing review or changing a stage/deadline.
- Latest submitted deployment source SHA-256: `8e1cb4994def7e0dd8257a88d35a4436acfddf941ec5e3d51175979255c7f7b9`. This is submission evidence, not a live recovery result.
- Made the existing retry rows due without resetting attempts or touching active leases. Added one ACT retry for `154b4c7d-78e9-4dc2-8989-1b70a5349aec` (`d3c0f268-02ec-43c7-92aa-9c870125b325`). The existing process-retry-queue schedule remains unchanged (`0 5-13 * * *`, plus the existing 18:00 job); no execution had occurred at the final read.

## Before evidence and final state

| Matter | Before evidence | Final read |
|---|---|---|
| `b2f9f64e-cc1c-49cc-91a9-0d5bf42bf7e7` | Run `af7aaa17-00b1-4940-b956-4c29ae34101b`; trace `6d384f55-02e3-47a7-ada0-e7f3b0d82231`; bucket `ddd4cc82-a142-48c0-9528-00971b7f4b10`; SQLSTATE `57014`, `AUTO QUE DEVUELVE PARA SUBSANAR`; daily acts cycle stuck `STARTED` | Retry `e7a34280-8c9b-4036-8be2-e06434a575e6` due, attempt 1/3. Still `PERSISTENCE_FAILED`; stale cycle has not yet been exercised by a caller. |
| `154b4c7d-78e9-4dc2-8989-1b70a5349aec` | Run `efbfe3ac-3690-440c-9da3-1ae9c2652372`; trace `a9ef596a-54a7-46e2-b343-e3750d2675a3`; enrichment SQLSTATE `57014` | New retry `d3c0f268-02ec-43c7-92aa-9c870125b325` due, attempt 0/3. Still `PERSISTENCE_FAILED`. |
| `6153c00f-4e3f-4ee8-aad2-064693ac3bb2` | Run `90183916-45b2-4020-b888-d981914c79b9`; trace `18252704-bb75-4041-be38-969a29e09039`; enrichment SQLSTATE `57014` | Retry `d4680e2e-a3be-414d-87aa-30bfaa060991` due, attempt 1/3. Still `PERSISTENCE_FAILED`. |
| `8dedc53e-c047-4976-9800-41ced849df92` | Run `62c916a1-ec00-4a90-9cf9-ee24c8a65e10`; trace `632675c9-6728-4214-a745-717c79f430c0`; enrichment SQLSTATE `57014` | Retry `c51abd14-9762-45fb-b331-38c7825cc25c` due, attempt 0/3. Still `PERSISTENCE_FAILED`. |
| `7b038fac-f82a-4619-8c10-fe1fe22b8d57` | Run `faff1338-7b04-41b1-ae99-267f31202ad5`; trace `ad8279a8-1ebd-4fe9-a5df-31cda31947d7`; `POST_INGEST_EFFECTS_PENDING`; act `eb10f20b-8d53-45bc-b764-a7af9eb80256`; `HEARING_SUSPENSION_TARGET_UNVERIFIED` | Retry `cef48d38-8869-4f6f-8157-88418b69feab` due, attempt 1/3. Review remains open; no hearing/stage/deadline was altered. |

Ofelia `72381c1f-c6d8-46ec-b300-b6121c558fe8` and Pinar `b422bbc4-23ca-4b18-9e7b-c2b067272cd2` also retain their original attempts and were made due where an unclaimed row existed. No new outcome existed at the final read.

An interactive scheduled call was rejected with 401 because the tool does not supply system identity. Minting the requesting user's own session found no matching account; minting the matter owner's session required interactive approval unavailable in this context. A manual user call also lacked an Authorization header. No identity was simulated and no service credential was read. Therefore none of the five matters is reported as recovered.

## PP / Arcila

For work item `13ee216e-8279-4224-850a-a332d97a2e5b`, article `272365833` remains represented by two distinct rows/fingerprints:

- `29fb40f4-baa5-4881-a818-d1999e93cf7d`: title names the 15th, `fecha_fijacion=2026-10-15`, `fecha_providencia=2026-10-14`.
- `d954d87f-5226-4abe-a5f6-d7f2613d599b`: title names the 15th, both structured dates are `2026-10-14`.

Both have an older downloaded queue artifact; neither has a certified full-read `validation_evidence` that proves the discrepancy should be rewritten. Their newer queue attempts ended at the five-attempt lease limit. The latest PP run `048aae4f-ea31-4da0-a487-f4731f778544` / backend run `9a1f6bab-9e9d-4cd8-8f23-d33b12a5b780` was `SUCCESS_EMPTY` with the daily plan incomplete, so it cannot certify new evidence. No date, fingerprint, native conflict or attachment queue row was changed, and no new PP extraction was started.

## MCP gates

Read back without changing privileges:

- `mcp_create_client(text,text,text,text,text)`: authenticated EXECUTE true; anon false.
- `mcp_update_client(uuid,jsonb,timestamptz,text)`: authenticated EXECUTE true; anon false.
- `mcp_correct_hearing(uuid,jsonb,timestamptz,text,text)`: authenticated/anon false.
- `mcp_reclassify_work_item(uuid,text,text,timestamptz,text,text)`: authenticated/anon false.

`get_capabilities` derives correction availability from live execution availability plus the manage grant. `supabase/tests/judicial_consistency_contract.sql` preserves the negative release gate. Positive/negative role-switch acceptance still needs the privileged rollback harness; no general grant was added. No MCP source changed, so no MCP regeneration or publication was needed. A real ChatGPT pagination check was not possible without an authorized session; no legacy `search` parameter was introduced.

## Verification

- `deno test --no-check --allow-env --allow-read ...`: 24 focused tests passed, 0 failed.
- `deno check supabase/functions/sync-by-work-item/index.ts`: passed.
- `git diff --check`: passed.
- Automatic preview builds through 19:45:21 UTC: `build OK`.
- A combined `deno check` including `process-retry-queue` hit the pre-existing local npm resolution error `ERR_PACKAGE_PATH_NOT_EXPORTED` for `@supabase/supabase-js/cors`; its focused runtime tests passed and the function deployed successfully. The dependency was not changed.
- No SQL integration test claimed for the stale-admission state transition: an isolated test database and an authorized interactive caller were unavailable. The installed function and ACL were read back, but live recovery remains unverified.

## Rollback

1. Redeploy `process-retry-queue` from `0cc6c674770b48bfd4efd1813d81586f7c93f9c5`.
2. Apply `supabase/release/stale_daily_admission_recovery_rollback_20261114.sql`, which restores the captured pre-change `_admit_daily_update_at` definition and does not rewrite cycle rows or grants.

No frontend/MCP publication, monitoring view/index change, cron change, secret/role change, external communication, legal classification/deadline edit or production content backfill was performed.
