# MCP candidate signatures — 2026-10-24 documentation/UI closure

Exact final candidate: **0.6.5 / 50 tools**, documentation/UI closure retained; root's 20:56 instruction supersedes the previous documentation-only 0.6.6 label. Implementation migrations unchanged at **0059–0079**.

Candidate public release marker: `https://andromeda.legal/connect-ai/mcp-rev-0-6-5`.

No edge deployment, publication, release SQL execution or hosted suite run by this agent. All eleven new mutation RPC gates are preserved. Root reports completed actual-schema rollback final delta checks: atomic update 20/20 PASS, freshness ties 6/6 PASS, alongside AUTH61/CURSOR26/FEED21/OPERATIONS40 PASS (two explicit feed-limit SKIPs retained); zero synthetic users/grants, all eleven gates closed, adapter/live SQL/signatures reviewed, no independent access blocker. This is root-provided evidence, not this agent's run. MCP-only release authorization is received; root retains grant SQL and frontend publication.

Concrete deployment limitation: managed MCP cannot be deployed independently via the development edge deployment tool; it activates only through app publish. Root reserved frontend publication, so that boundary was not bypassed. Public unauthenticated check returned `mcp-rev-0-6-4`; candidate `mcp-rev-0-6-5` is not yet verified as deployed. No services newly enabled; existing Cloud backend/OAuth retained unchanged.

## Changed files in this closure

- `src/pages/SettingsConnections.tsx` — removed development-review copy; retained scope/ten-day retention and explicit own-session, per-tool opt-in/revoke disclosure.
- `src/pages/ConnectAI.tsx` — matching public disclosure without permanent blocked-release language.
- `src/lib/mcp/tools/get-capabilities.ts` — first-party opt-in/revoke guidance; runtime availability logic unchanged.
- `src/lib/mcp/index.ts` — instructions, version and public revision marker.
- `public/.well-known/mcp.json` — matching candidate version.
- `supabase/functions/mcp/index.ts` — regenerated from source, never hand-edited.
- `.lovable/mcp/manifest.json` — extracted inventory, 50 tools.
- `supabase/release/mcp_write_rpcs_enable.sql` — comments only; all eleven grant statements unchanged and unexecuted.
- `docs/mcp-release-readiness-20261024.md` — root-provided hosted evidence and current atomic-delta release checkpoint.
- `docs/mcp-release-signatures-20261024.md` — this signature record.
- `roadmap.md` — closure recorded and remaining root-controlled steps updated.

Persistent copy constraint also saved in project memory (`mem://constraints/mcp-release-copy`, indexed in `mem://index.md`); no architecture change.

## SHA-256 candidate fingerprints

```text
414f16bb6398cd7859803af0bfc5008cf79082149c792abac090499fa432f01c  src/lib/mcp/index.ts
6b45284821a9c442b835cbc5eac0f27855425f7160e0dd94c0191d222c4bf714  src/lib/mcp/tools/get-capabilities.ts
1d8f9c597f33d0869bef3e73ae7ab5f99b13a4a6ab639a9e119a15b7df818d8f  supabase/functions/mcp/index.ts
c6b8e3177a6af2eb20aefaa92ae00db8cc9d71cd2f406f1f05ad3ba4397fe9c8  public/.well-known/mcp.json
2c813ecf031aeff6a4fb5133e2b4d74990818696b5af7a602e9ee3edde609c87  .lovable/mcp/manifest.json
9608dbda8dc6c496448e7e5abdd01bc2a3e57676e2e79e7b118995584ea2da16  supabase/release/mcp_write_rpcs_enable.sql
```

Fingerprints identify local candidate bytes; they are not a claim that the hosted endpoint changed.

## Gated release RPC signatures (unchanged)

```text
public.mcp_create_work_item(text,text,text,text,uuid,text,text,text,text,text)
public.mcp_work_item_lifecycle(uuid,text,timestamptz,text,text)
public.mcp_move_work_item_stage(uuid,text,timestamptz,text[],text,text)
public.mcp_resolve_stage_suggestion(uuid,text,timestamptz,text[],text,text)
public.mcp_resolve_alert(uuid,text,text,text)
public.mcp_set_notification_state(uuid[],text,timestamptz,text)
public.mcp_resolve_email_question(uuid,text,text)
public.mcp_add_email_association(uuid,uuid,text)
public.mcp_resolve_detected_process(uuid,text,uuid,text)
public.mcp_assign_work_item_radicado(uuid,text,timestamptz,text)
public.mcp_update_work_item(uuid,jsonb,boolean,text,text)
```

## Checks actually performed for this closure

- 34 Vitest tests PASS across six files, including six rendered SettingsConnections tests and six atomic/runtime capability contracts; synthetic responses only, no real-user impersonation.
- MCP source check: `bunx tsgo --noEmit -p tsconfig.mcp.json`, exit 0.
- `bun run check:mcp:artifact`, exit 0; artifact regenerated and handler registered.
- Manifest extraction: 50 tools, version 0.6.5; source/artifact and all 34 tests rerun PASS after exact-version alignment at 20:57 UTC.
- Public `/connect-ai` checked with Playwright at 1280×1800 and 390×844; own-session opt-in/revoke and ten-day disclosure visible, no horizontal overflow, zero page errors. SettingsConnections authenticated browser flow was not rerun; its rendered synthetic suite passed.
- Supervised app validation: latest observed entry `2026-10-24T20:57:29Z`, **build OK**.

No hosted suite was rerun in this closure; historical local DB results and root's separately provided hosted results remain distinct.