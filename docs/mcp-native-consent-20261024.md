# Native permission choice — 2026-10-24

Baseline: 2b90c64e32f879fe4b984cbd1edd8ae637041fc4. MCP stays 0.6.6 / 50 tools; endpoint, issuer, source/artifact and released eleven action signatures are unchanged. No publishing, agent deployment, real-account opt-ins, portfolio writes, provider or scheduler changes.

## Changes
- Native consent verifies account with getUser and authorization with official getAuthorizationDetails plus native-only mcp_native_authorization_identity. The resolver checks existing _mcp_require_first_party, authorization ownership, pending/approved status, expiry and active client, returns only client ID/name/scope. No authorization codes, state or credentials returned.
- Both initial and redirect-only existing consent show default consultation / explicit management choice. approveAuthorization uses skipBrowserRedirect:true; save grant or revoke earlier management, then exact-client authoritative readback before callback. Callback exists only in memory; failed saves/readbacks stay on-page with retry and explicit verified-read fallback, no second approval. Cancellation never grants.
- Narrow andromeda:read without andromeda:manage disables management. Native mcp_access_level is not used to verify a target client.
- AI connections precede Outlook, have ai-connections anchor, and are linked from Settings/sidebar. Settings mutations verify saved permission; failed/unknown states disable changes. Guides no longer advertise twelve tools or notes-only writes.

## Verification
- 22 rendered Vitest checks PASS (15 consent, 7 settings): initial/redirect-only, explicit management/default read, earlier management removal, approval failure/no mutations, save failure/retry/no second approval, failed/successful read fallback, wrong/missing client, failed readback, narrow scope, account reset, duplicate click, cancellation, settings failure/refresh.
- 8 PostgreSQL checks PASS, local synthetic schema, BEGIN/verdict/ROLLBACK: pending/approved identity whitelist, foreign/expired/denied/unknown rejection, non-native session mismatch, deleted client. Existing caller-context implementation reused; missing native helper copied exactly into transaction fixture. This is local preparatory evidence, not hosted actual-schema acceptance.
- Browser fixture renders desktop 1280x1800 and mobile 390x844, choice selectable, management-labelled button visible, AI connections first, no horizontal overflow. No real session or opt-in used.
- MCP source tsgo check and generated artifact handler validation PASS; baseline SHA256 signatures unchanged. Automatic app compilation reports build OK.
- Hosted read-only spot checks confirm create/update/assign execution remains enabled. Migration only adds the read-only native resolver; does not change any released action privileges.

## Review boundary
Root reviews and publishes frontend. Live external OAuth approval with real accounts deliberately not exercised. Root may run the resolver negatives against hosted actual schema with rollback-only fixtures. No private tokens/codes logged or stored.
