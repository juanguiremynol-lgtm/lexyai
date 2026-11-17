# MCP access incident — 2026-11-17

## Evidence (no tokens, no bodies)
| UTC | Probe | Result |
|---|---|---|
| 12:21:47 | POST /functions/v1/mcp initialize, no token | 401 (edge runtime + MCP auth gate alive) |
| 12:21:47 | GET /functions/v1/mcp/.well-known/oauth-protected-resource | 200, marker mcp-rev-0-6-19 |
| 12:21:52 | GET /auth/v1/.well-known/oauth-authorization-server | 522 after 19.5 s |
| 12:21:52 | GET /auth/v1/.well-known/jwks.json | 522 after 19.8 s |
| 12:25:04 | GET /auth/v1/health, /rest/v1/rpc/mcp_access_level, OAuth metadata, JWKS | 522 after ~19.7 s each |
| 12:20, 12:25 | SQL via managed pooler | SUPABASE_POOLER_UNAVAILABLE |
| 12:20 | Managed status endpoint | reports healthy (contradicted by probes) |
| 12:32:27 | Managed status / db_health | status healthy (not paused); db metrics unavailable |
| 12:32:36 | auth health, OAuth metadata, JWKS, rpc/mcp_access_level | 522 after ~19.5 s each |
| 12:32 | SQL via managed pooler | SUPABASE_POOLER_UNAVAILABLE |

## Demonstrated blocker (not root cause)
Observed: auth, OAuth metadata, JWKS and PostgREST return HTTP 522 (proxy could not reach origin) and the managed SQL
pooler is unavailable, repeatedly between 12:21 and 12:32 UTC; only the edge-function runtime answers. While this lasts
the MCP cannot validate tokens nor run RPCs. This failure alone does not justify reconnecting; it does not rule out a
coexisting credential problem, which cannot be assessed until the origin answers.
Root cause of the origin outage: NOT determined. Managed status reports healthy; db_health metrics unavailable;
last exhaustion alert DiskIO budget <50% at 2026-11-16 17:36Z (historical, not proof of current pressure).
No paused/inactive state was reported, so the out-of-credits "Wake up" path is not evidenced for this project.

## Hypothesis only
authenticator statement_timeout/lock_timeout=8 s and slow pg_type introspection (7.1 s, 16/11) may slow schema-cache
reloads after restarts. Not demonstrated; not changed.

## Code fix (src/lib/mcp/backend-failure.ts)
get_capabilities, get_user_context and requireWriteScope classify failures as AUTH_REQUIRED / SESSION_UNVERIFIED /
BACKEND_UNAVAILABLE / EXECUTION_UNAVAILABLE. Explicit codes win over messages (PGRST202 = missing function ->
EXECUTION_UNAVAILABLE; PGRST000-003 = backend). Errors are aggregated (outage outranks 401); client construction and
sync throws are fail-closed; a page failure returns no partial count; bare TypeErrors are INTERNAL, not NETWORK;
signal is whitelisted (SQLSTATE/PGRSTnnn/HTTP_nnn/NETWORK/TIMEOUT/INTERNAL/UNKNOWN). Results: see
docs/mcp-access-verification-20261117.json.
Marker bumped to mcp-rev-0-6-20.

## Not done
No restart, timeout change, session/grant/consent change, or deploy (MCP ships only with app publish and the backend was down).
