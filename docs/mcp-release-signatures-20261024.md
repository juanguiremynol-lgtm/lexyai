# MCP candidate signatures — 2026-10-24 documentation/UI closure

Candidate: **0.6.6 / 50 tools**, documentation/UI closure over **0.6.5**, implementation migrations unchanged at **0059–0079**.

Public release marker: `https://andromeda.legal/connect-ai/mcp-rev-0-6-6`.

No edge deployment, publication, release SQL execution or hosted suite run by this agent. All eleven new mutation RPC gates are preserved. Root must complete the atomic-update delta test and separately authorize enablement and deployment/publication. Root-provided hosted baseline results are recorded in `docs/mcp-release-readiness-20261024.md`, not represented as this agent's run.

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
5b162043bff31d6d0246404d7cd23537e7fd0295b1e5530743f7c4ab881a9236  src/lib/mcp/index.ts
6b45284821a9c442b835cbc5eac0f27855425f7160e0dd94c0191d222c4bf714  src/lib/mcp/tools/get-capabilities.ts
af81c5ffc789595093c21ebafe1fc3b496b986a75553d7f96aa5983f8a970645  supabase/functions/mcp/index.ts
8c2e8ed393f68a8d31e13d0395a5a818be4a26a14ada98cc91626cdde65693d9  public/.well-known/mcp.json
efea1843c378890cf19c1c9e13eeb4c1d129b5e3a63f4530fc7dd2d30fc92e0e  .lovable/mcp/manifest.json
74dc2cef519989db932ee22999ca17a00a7ea7581fc7de50df89c674e80e8c69  supabase/release/mcp_write_rpcs_enable.sql
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
- Manifest extraction: 50 tools, version 0.6.6.
- Public `/connect-ai` checked with Playwright at 1280×1800 and 390×844; own-session opt-in/revoke and ten-day disclosure visible, no horizontal overflow, zero page errors. SettingsConnections authenticated browser flow was not rerun; its rendered synthetic suite passed.
- Supervised app validation: latest observed entry `2026-10-24T20:52:58Z`, **build OK**.

No hosted suite was rerun in this closure; historical local DB results and root's separately provided hosted results remain distinct.