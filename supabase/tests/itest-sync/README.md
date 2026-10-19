Production follow-up: migration007 preserves ZIP/XLSX reading evidence separately
from PDF evidence. The native body-CAS suite has six tests, including TS/SQL
observation-order parity for archives and retained member associations when
bytes are identical. The collector reads every supported ZIP member, validates
CRC and parses/renders PDF members; XLSX validation reads workbook relationships
and stored worksheet values, without recalculating formulas. Neither checksum,
readability nor a source descriptor certifies complete integrity or legal content
attribution. Unsupported members remain pending. A ZIP remains one source
attachment with its own member manifest, not separate source solicitudes.

# Native integration harness for sync-by-work-item

Production verification added migration006, `rpc_enrich_work_item_act`, to keep
the large expected raw/document values in the POST body. Filtering on their
full JSON in a PATCH URL exceeded the hosted gateway's URL limit. The RPC
retains atomic equality checks and rejects source-identity fields. Its native
test is `enrichment-body-cas.test.ts` on the same isolated PostgreSQL/PostgREST
fixture as the temporal evidence tests; it exercises >64 KiB request bodies,
concurrent associations, protected source fields and anonymous denial. RPC
transport errors abort the remaining batch as `PERSISTENCE_UNKNOWN` before a
later run reloads all candidates.

This harness runs the real `sync-by-work-item/index.ts`, Supabase client HTTP
requests, PostgREST, PostgreSQL 17, the application RPC, and the public schema's
actuation triggers, indexes and RLS policies. The upstream SAMAI feed and case
records are synthetic. It never deploys or writes to a hosted database.

The earlier README recorded an unavailable sandbox and unexecuted scenarios.
Those statements describe that earlier attempt. The subsequent request explicitly
authorized rebuilding a disposable local database, local roles and synthetic JWTs.
The native runs documented below were executed after that authorization.

## Local prerequisites

The tested versions were PostgreSQL 17.6, PostgREST 12.2.3, Deno 2.5.4 and Node
24.15.0. Python 3 and a `psql` client are also required. The database server must
be disposable and reachable only at `127.0.0.1:54329`; the scripts reject a server
outside PostgreSQL 17. They explicitly select the local host, port and user and
remove ambient PostgreSQL connection variables.

The current disposable server was started with:

```sh
docker run --detach --name samai-itest-postgres17 \
  --publish 127.0.0.1:54329:5432 \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --tmpfs /var/lib/postgresql/data \
  postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929
```

Do not run that command again if this named test server already exists. Other
isolated tests may be using separate databases on it.

`bootstrap.py` requires reviewed, private schema-only catalog exports under
`/tmp/itest`: `catalog-{enums,columns,constraints,sequences,indexes,triggers,
policies,tables,views}.json`, plus `catalog-functions-*.json`. Each contains a
`rows` array from authorized read-only catalog queries. The fields consumed by
the builder are explicit in `build-catalog-schema.py`. Do not substitute a live
connection string or private business rows for these artifacts. The inspected
snapshot contained 336 public tables, 392 functions, 45 enums, 15 views, 256
triggers and 778 policies. All were recreated locally; the tested act table has
its 16 production triggers enabled.

The five `reference-*.json` inputs contain the inspected deadline rules,
providencia classification rules, Colombian holidays, judicial suspensions and
holiday coverage. Only global suspensions with no owner are imported. Reference
rules are needed to exercise the existing downstream behavior faithfully.

The `auth` and `cron` schemas in `prelude.sql` are local fixtures, including a
minimal `auth.users` and JWT claim accessors. Client table grants reproduce the
catalog ACLs and RLS tests use distinct synthetic users. This is a reconstruction
of the public schema and its relevant behavior, not a complete hosted Supabase
installation or a verification of every platform service and privilege.

## Prepare and run

From the isolated application checkout, with the reviewed catalog inputs in
place:

```sh
export PATH=/tmp/samai-tools/node24/bin:/tmp/samai-tools/bin:$PATH
export DENO_DIR=/tmp/samai-tools/deno-cache
export ITEST_REPO=/tmp/lexyai-samai-rev2

# Download only application imports, then execute tests from the cache.
DENO_TLS_CA_STORE=system deno cache --no-check \
  supabase/functions/sync-by-work-item/index.ts \
  supabase/tests/itest-sync/gateway.ts \
  supabase/tests/itest-sync/native-http.test.ts

python3 supabase/tests/itest-sync/bootstrap.py
python3 supabase/tests/itest-sync/drive.py
python3 supabase/tests/itest-sync/native-sql.py
python3 supabase/tests/itest-sync/historical-repair-native.py
```

`bootstrap.py` recreates only the local `sync_itest` template and `sync_run`,
loads the inspected public schema and reference rules, applies
`20261019000100_samai_origin_identity.sql`,
`20261019000200_samai_publication_evidence.sql`,
`20261019000300_estado_document_recovery.sql` and
`20261019000400_act_document_observation_order.sql`, and seeds invented users and a case.
It creates synthetic local JWTs matching `postgrest.conf`; these are never hosted
credentials. The SQL suites create their own disposable clones.

The driver starts local PostgREST, the gateway and the real edge function. The
function process gets a clean environment, local URLs, cached imports and a
network permission limited to local endpoints. The gateway serves synthetic
SAMAI data and fault injection. No hosted function, email provider or external
SAMAI request is made. A file lock prevents simultaneous drivers from resetting
the same database. After **every** reset, the driver waits until an authenticated
read through PostgREST returns the synthetic case, rather than relying on an
open port or an unrefreshed schema cache. It stops its child processes on exit.

To rerun only the native HTTP client tests after a relevant helper change:

```sh
python3 supabase/tests/itest-sync/drive.py --native-only
```

This overwrites `results.json` and `native-http-output.log`; preserve prior full
run results first when both are needed as evidence. A nonzero driver exit means
a failed check. Do not hide that exit status with a subsequent `tail` command.

## Coverage and observed results

The full native driver passed **35/35 checks**, including its then-four native
HTTP tests. After the final conditional date-enrichment change, the expanded
native HTTP group passed **5/5**. The native SQL suite passed **12/12**, and the
synthetic historical rehearsal passed **6/6**. These are actual native runs, not
the prior limited-schema PGlite results.

| Scenario | Assertion |
| --- | --- |
| S1–S3 | Distinct same-date/title solicitudes remain separate; repeat ingestion is idempotent; a later indice enriches only its origin and preserves UUID/fingerprint. |
| S4 | Repetition within a batch enriches the persisted row; a later linkless feed preserves attachment evidence. |
| S5 | Transport and database write failures stay visible, do not count as success, and can be retried without partial or duplicate acts. |
| S6 | A commits, then read-back errors or returns no row: exactly one act RPC occurs, distinct B is not attempted, and the response is `PERSISTENCE_UNKNOWN`. A subsequent run reloads A and adds B without changing A's UUID/fingerprint. |
| S7–S8 | More than 1,000 stored acts paginate correctly; ordinary sync leaves contaminated historical text untouched. |
| S9 | Three zero-row PATCH responses produce `PERSISTENCE_FAILED`, no successful write count, no act/downstream change and no advance of successful-sync timestamps. |
| S10 | A traslado ingested through the real function produces no alert asserting a granted cautelar; the real notification trigger runs, and no dated deadline appears without an anchor. |
| Native HTTP | A stale fingerprint cannot overwrite a different request; a known solicitud rejects unrelated index-only and insufficient-origin entries. |
| Native concurrency | Two real HTTP clients read the same attachment state, race conditional PATCHes, and preserve both documents after one genuine zero-row response and fresh-read retry. |
| Native dates/RLS | Null date metadata is filled, a concurrent date writer survives retry, the owner sees its acts and another authenticated user cannot read or update them. |
| Native SQL | RPC unions incoming raw-only documents, fills later indice over explicit null, and detects both INSERT and UPDATE suppressed by a trigger returning NULL. |
| Rollback | Legacy uniqueness restores before conflicting legitimate origins exist; afterwards rollback refuses before DDL and leaves all rows and the new index unchanged. |
| Historical rehearsal | Three synthetic split pairs preserve original IDs/fingerprints/description/dates, suppress new notifications/alerts/deadlines/hearings, and leave announced annexes unverified. |

The separate, private, review-only historical SQL was also replayed against its
three act before-images and two alert before-images in a local clone with
synthetic owner/org records. All production triggers were active during replay.
The two alert titles/payloads changed as proposed while statuses remained
`PENDING` and `RESOLVED`; protected fields and downstream rows were preserved,
no trigger logged a new error, and the final `ROLLBACK` restored the full snapshot.
That rehearsal does not authorize applying the script in production.

Evidence is private under `/tmp/itest`: `full-http-results.json`,
`full-http-output.log`, `native-http-output.log`, `native-sql-results.json`, and
`historical-repair-results.json`. Exact historical replay evidence is under
`/tmp/samai-investigation-20261018/historical-exact-native-replay-results.json`.
Catalogs, JWTs and real before-images must not be committed. A non-sensitive
summary and evidence hashes are in `validation-results.json` beside this README.

These tests do not establish that the whole application compiles cleanly, recover
any PDF, validate hosted delivery, or authorize production migration or historical
repair. `HISTORICAL_REPAIR_SCOPE` remains `null`. Restoring the old uniqueness rule
must never be forced by deleting or archiving legitimate separate requests.

## Revision 2: document inventories through the application RPC

On 2026-10-19 the harness was rebuilt from the same private catalog snapshot in
PostgreSQL 17.6, using the pinned Docker image above, PostgREST 12.2.3 and Deno
2.5.4. The current implementation was exercised again; earlier execution logs are
not used as proof of the current code. Schema counts and input hashes are in
`/tmp/samai-functional/evidence-r2/rpc-schema-*.json`.

An optional inventory replay now reads the reviewed private evidence directory:

```sh
ITEST_INVENTORY_EVIDENCE=/path/to/private/evidence \
  python3 supabase/tests/itest-sync/drive.py --inventory-only
```

The directory must contain `inventory-matrix.json` and the two saved
`original/<radicado>-raw.json` observations. It is not a hosted service URL.
The replay passes all 34 inventories (the original 24 plus 10 other inventories)
and the six memorial rows through the real function, normalizer, Supabase HTTP
client, PostgREST and native RPC with all act triggers enabled. Every inventory
is checked individually against its source index, descriptor URLs and
descriptions; top-level documents must equal raw document evidence. The six
memorials must retain their own identities without receiving unrelated PDFs.
Repeated sync and a later omitted inventory must preserve IDs, fingerprints,
documents, notifications, alerts, deadlines and hearings.
The existing deadline RPC appends corroboration audit entries and changes the
same rows' `updated_at` on repeat sync. The replay records those differences and
permits only that append and timestamp change; IDs, substantive deadline fields,
all prior audit entries, and all other downstream rows must remain unchanged.
This is not a review or correction of the underlying deadline calculation rules.

`inventory-rpc-results.json` records each inventory separately. These are saved
source observations replayed in a local database with synthetic owner and work
item records. The feed is a fixture, the application RPC is real, and no file is
downloaded or newly validated by this suite. It therefore closes the application
persistence verification gap but does not recover any missing memorial annex.

The native HTTP suite also tests identical file bytes under two distinct annex
IDs and two separate solicitudes. Repeated ingestion preserves both annex
associations on the first act and the independent association on the second,
without emitting downstream effects. Concurrency tests still provoke a real
zero-row conditional update and confirm a fresh read preserves both documents.

The final revision-2 run on 2026-10-19 rebuilt the template with all four
prepared migrations, including `20261019000400_act_document_observation_order`.
It passed 81/81 driver checks (the six native HTTP tests count as one driver
group), 6/6 native HTTP tests and 12/12 native SQL checks. The 34 inventories
were individually replayed again through the final function and RPC. The
migrated public schema has 404 functions; its 336 tables, 256 triggers, 778
policies and all 16 enabled act triggers remain present. Final logs, per-inventory
results and schema/source hashes use the `final-r2` suffix under
`/tmp/samai-functional/evidence-r2`; `rpc-verification-final-r2.json` summarizes
this run separately from the earlier two-migration run. No historical repair
was executed and `HISTORICAL_REPAIR_SCOPE` remains `null`.
The final build then required the equivalent `Object.hasOwn` to
`Object.prototype.hasOwnProperty.call` substitution in `actDocumentObservation.ts`.
All six native HTTP tests passed again with that final helper. The 81-check/
34-inventory run predates only that compatibility substitution; the source
manifest and `rpc-build-compatibility-addendum-final-r2.json` retain both hashes
and distinguish the two executions.

## Isolated estados recovery verification

Bootstrap applies all four prepared migrations in order: origin identity
`20261019000100`, publication evidence `20261019000200`, and the estado queue
claims/finalization `20261019000300`, then act document observation ordering
`20261019000400`. The estado queue migration must precede the new
`process-estado-attachments-queue` deployment; the worker also requires the
existing dedicated `x-cron-key` or a service-role bearer. Its PDF.js dependency is
pinned to `4.10.38` using a Deno npm import. The deployable function bundle must
include `estadoAttachmentRecovery.ts`, `estadoDocumentAccess.ts`, and
`estadoPdfReading.ts`. No service endpoint or cron configuration is changed by
these migrations. Production scheduler authentication must be verified before
activating the proposed worker.

Clone `sync_estados` from the prepared `sync_itest` template, independently from
`sync_run`. Run `src/test/samai-estados-ingestion.test.ts` with
`SAMAI_ESTADOS_RPC=1` to exercise the actual adapter, canonical mapping and SQL
RPC with full production schema and synthetic owners. An optional
`SAMAI_ESTADOS_CAPTURE` file replays the preserved real upstream publication
observation into a separate isolated work item of the same radicado. Then run
`python3 supabase/tests/itest-sync/estados-queue-native.py` for concurrent native
claims, association/path checks, guarded finalization, retry limits and denial
to the anonymous DB role. These tests use synthetic file-reading evidence for
the SQL portion and do not consume any production queue.

The Vitest `estado-attachment-recovery.test.ts` executes the actual recovery
state machine with HTTP, storage and PDF reader explicitly simulated. The Deno
tests `estadoPdfReading_test.ts` execute the real parser on generated PDFs,
reject malformed/truncated files, and read text and operators on every page.
They run with `--node-modules-dir=none --allow-read --deny-ffi --deny-run`; the
worker authentication test additionally requires `--allow-env`. This validates
parsing and page content processing, not visual rendering, signatures or
complete integrity. Source-declared SHA256 bound to the exact document URL is
required for a verified association; the locally computed SHA is traceability.
Without that source evidence the obtained copy stays pending and cannot set
`pdf_available=true`. Retries remain bounded. Unknown download origins are
rejected, and every redirect is rechecked before any provider key is attached.

No statement above establishes retrieval of an annex of the six memorials,
tests a production queue execution, or authorizes deployment/historical repair.

The worker's `deno.json` and `deno.lock` are scoped to its own directory; no
root lock pins unrelated functions. Exact frozen verification commands:

```sh
deno check --config supabase/functions/process-estado-attachments-queue/deno.json --frozen \
  supabase/functions/process-estado-attachments-queue/index.ts
deno test --config supabase/functions/process-estado-attachments-queue/deno.json --frozen \
  --no-check --allow-env --allow-read --deny-ffi --deny-run \
  supabase/functions/_shared/estadoPdfReading_test.ts \
  supabase/functions/_shared/estadoWorkerAuth_test.ts
```
