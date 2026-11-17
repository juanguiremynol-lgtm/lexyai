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

## Demonstrated cause
The origin behind auth, PostgREST and Postgres is unreachable (HTTP 522 = proxy cannot reach origin; pooler unavailable).
Only the edge-function runtime answers. The MCP cannot validate tokens (JWKS) nor run any RPC, so every tool fails.
This is managed infrastructure, not the user's account, OAuth client, consent or grant — reconnecting cannot help.

## Hypothesis only
authenticator statement_timeout/lock_timeout=8 s and slow pg_type introspection (7.1 s, 16/11) may slow schema-cache
reloads after restarts. Not demonstrated; not changed.

## Code fix (src/lib/mcp/backend-failure.ts)
get_capabilities, get_user_context and requireWriteScope classify failures as AUTH_REQUIRED / SESSION_UNVERIFIED /
BACKEND_UNAVAILABLE / EXECUTION_UNAVAILABLE; outages never recommend reconnecting and never return permissions.
Marker bumped to mcp-rev-0-6-20.

## Not done
No restart, timeout change, session/grant/consent change, or deploy (MCP ships only with app publish and the backend was down).
