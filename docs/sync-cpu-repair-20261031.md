# Scoped sync CPU repair — 2026-10-31

## Demonstrated failure
- Controlled request 961, trace `e14e3ee7-ef39-4406-b66b-e2d12c19b6db`, matter `2a590db7-0330-4b8d-9403-5963e4bd15a1`.
- Edge HTTP log: 546, 39,513 ms, deployment revision 2380, at 17:06:48.865 UTC. Runtime explicitly reports **CPU Time exceeded**, not memory/payload exhaustion. No final success log.
- Feed returned 172 acts; adapter delivered 147; ingestion loaded 217 semantic tuples. Last messages were confirmed act processing/disabled stage inference. Runtime does not supply a stack at the kill; an exact final instruction cannot be attributed.
- Read-only database evidence: 230 active acts, 9,632,721 raw JSON bytes, 9,230,804 document JSON bytes; retained document versions account for the bulk. No rows changed by this intervention.

## Local reproduction and exact correction
Local CPU profiling of the actual stored rows, with no provider calls or model runs, identified repeated recursive canonical serialization in document enrichment. Stored JSON was kept privately under `/tmp`, never copied into this report.

Changes only in shared document-processing code:
- `actDocumentObservation.ts`: one history union rather than recanonicalizing the growing union twice; recursive WeakMap canonicalization scoped to a single operation; reuse observations already free of nested history. No history versions are discarded.
- `actDocumentos.ts`: structural canonical-JSON equivalence for unchanged descriptor trees rather than allocating and sorting full JSON strings; share the operation-local canonicalizer across the document union. No global cache, no cache across writes. Remove the existing non-null assertion through a null guard.
- One focused regression checks a shared proof is traversed once, all 54 history versions remain, current observation stays current, and a later operation sees mutated evidence.
- Subdirectory architecture rule updated. Entrypoint `sync-by-work-item/index.ts` unchanged from main `15844b42`.

Measured local stored-row enrichment: baseline 1080/1087/1100 ms; corrected 547/576/608 ms (medians approximately 1087 versus 576 ms, 47% lower). This is local processing time, not hosted CPU telemetry, wall-clock sync duration, or monetary savings. Differential comparisons on all 230 stored rows produced identical normalized descriptors, document unions and enrichment patches.

## Validation and deployment
- 55 existing/focused Deno tests passed across document observations, descriptors, origin identity and batch persistence; one regression added.
- `deno check supabase/functions/sync-by-work-item/index.ts` passed.
- Supported deployment tool successfully deployed **only sync-by-work-item**. Submitted source/config SHA-256: `d679664addfe0fbd657f9d34364944182365efd6749b157e05f2c20ad28566b3`.
- Source revision containing the deployed code: `13792536ec9a1a631c9c295981b7f1c63d90e486` (descends from `15844b42`; intervening generated types left untouched).
- File SHA-256: observation helper `5d921b65ce3eb829073a093d40a54ff4cdc029607117a8981505182d4dfe4dc0`; document helper `3db6ab37cb6acb89f3cd4f7d0dbf9fdcecd51c2cb8bd85b5f3bc7c724977b847`; unchanged entrypoint `01f6236d40ecfac65cd5e4376aef54602ec3f3431bae8da79e576c2cee577209`.
- Deployed health-check short circuit returned HTTP 200 at 17:14:33 UTC, execution `39d9afe4-b18c-46db-95a8-6e3a1083e82b`. It had no matter identifier and did not invoke providers or reopen any cycle. Health confirms deployment starts, not completion of the failed matter. Fresh deployment-number analytics were not yet available.

## Preserved limits and outstanding acceptance
No migrations, cycle resets/readmissions, provider enrollment changes, RLS changes, identity/fingerprint edits, historical repairs, document generation, alerts/terms changes, UI/MCP work, retries or judicial portal queries. Tiny unchanged. No durable continuation added: the demonstrated cause is CPU work; its necessity is not proved after this correction.

The owner's controlled recovery remains necessary to establish hosted end-to-end completion. This intervention does not certify that the case is complete or that the 546 cannot recur under a different workload. No daily-gate state was repaired or declared successful.