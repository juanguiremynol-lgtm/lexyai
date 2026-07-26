# Andromeda como MCP server público — Diagnóstico y arquitectura

## Respuestas a tus preguntas

**(a) ¿Qué hay hoy en `functions/v1/mcp`?**
Ya existe y está más avanzado de lo que asumes. Es un servidor MCP generado por el SDK `@lovable.dev/mcp-js` desde `src/lib/mcp/` (entrada `index.ts` + 3 tools). El archivo `supabase/functions/mcp/index.ts` es autogenerado por `mcpPlugin()` en `vite.config.ts` — no se edita a mano.

- Tools expuestas hoy: `list_work_items`, `get_work_item`, `list_recent_estados`. Nada más.
- Transporte: **no es SSE**. Es el handler Streamable HTTP del SDK (POST JSON-RPC en `/functions/v1/mcp`), más rutas auxiliares `/.mcp/list-tools`, `/.mcp/invoke-tool/<tool>` y `/.well-known/oauth-protected-resource`. Es decir, el estándar 2025 ya está; no hace falta un segundo transporte.
- Auth: **ya es OAuth**, no anon/service key. `defineMcp` usa `auth.oauth.issuer({ issuer: https://<ref>.supabase.co/auth/v1, acceptedAudiences: "authenticated" })`, y valida el Bearer en cada llamada.

**(b) ¿Hay tablas de OAuth clients/tokens?**
No hay ninguna en `public`, y **no hay que crearlas**. El authorization server es Supabase Auth (managed): authorize, token, refresh, JWKS, consentimiento y registro dinámico de clientes (DCR) ya están activos. Verificado ahora mismo: OAuth server *Enabled*, DCR *Enabled*, Site URL `https://andromeda.legal`, consent path `/.lovable/oauth/consent`, y `andromeda.legal` en la allow-list. Construir nuestras propias tablas de clients/tokens sería reimplementar (mal) un authorization server ya certificado.

**(c) ¿RLS o service role?**
RLS con identidad real. Cada tool crea un cliente con la anon key + `Authorization: Bearer <token del caller>`, así que las políticas corren como ese usuario. Ninguna tool usa service role. El aislamiento multi-tenant es correcto por construcción — la regla dura a mantener es: **ninguna tool MCP puede tocar `SUPABASE_SERVICE_ROLE_KEY`**.

**(d) Herramientas de IA conectadas hoy**
Ninguna. No hay conectores MCP conectados al proyecto, y la memoria del proyecto no registra ninguna integración Claude/ChatGPT del Doctor. Sería la primera conexión externa; conviene hacer el piloto con Claude Desktop/claude.ai (el cliente MCP más maduro) y validar ChatGPT después.

**(e) Recomendación: un solo endpoint.**
Un solo edge function `mcp` con el verificador OAuth del SDK. Un `mcp-public` separado duplicaría transporte, catálogo y superficie de auditoría, y el "público" no es un endpoint distinto: el mismo endpoint es públicamente descubrible y cada llamada llega autenticada como un usuario concreto.

---

## Correcciones a tu diseño (importantes)

1. **No construir OAuth propio.** Tu punto 3 describe un authorization server que ya tenemos. `andromeda.legal/connect` no debe emitir tokens; el flujo real es: la herramienta descubre el authorization server → registra cliente por DCR → manda al usuario a `/.lovable/oauth/consent` → aprueba → recibe access+refresh. Andromeda solo aporta la **pantalla de consentimiento** y el **panel de revocación**.
2. **Scopes granulares (`read:actuaciones`, `write:notes`) no existen en este authorization server.** Los tokens de Supabase llevan scopes de identidad (`openid email profile`), no permisos de dominio. La autorización real se aplica en dos capas que sí controlamos: **RLS** (el usuario solo ve lo suyo) y **el catálogo de tools** (si no existe una tool de borrado, nadie borra). El "modo solo lectura" se implementa como una preferencia por conexión almacenada en Andromeda, no como un scope OAuth.
3. **Bloqueador real encontrado:** el JWKS del proyecto está **vacío** (sin clave asimétrica ES256). Con firma HS256 legacy, Supabase no puede firmar el ID token del flujo OAuth y el login desde Claude falla con *"HS256 is not supported for ID token signing"*. Hay que migrar las signing keys antes que cualquier otra cosa. Este es el motivo por el que hoy, aunque todo parece configurado, una conexión externa no completaría.
4. **Bug latente en `get_work_item`:** consulta la tabla `work_item_estados`, que **no existe** (la real es `work_item_publicaciones`). Devuelve estados vacíos siempre.
5. **`/.well-known/mcp.json` no es un mecanismo de descubrimiento real.** Claude y ChatGPT no lo leen: el usuario pega la URL del servidor y el cliente descubre auth vía `/.well-known/oauth-protected-resource` (que el SDK ya sirve). Vale la pena una página `/connect` **humana** con la URL a copiar e instrucciones por cliente, no un JSON inventado.
6. **`add_audience` y `add_note` sí son viables**, pero las audiencias tienen reglas de dominio (tipos, plantillas de flujo). Empezar por notas y dejar audiencias para una segunda tanda, con `destructiveHint` y confirmación del lado del cliente.

---

## Arquitectura propuesta

```text
Claude / ChatGPT / Cursor
        │  1. pega https://<ref>.supabase.co/functions/v1/mcp
        ▼
 /.well-known/oauth-protected-resource   (lo sirve el SDK)
        │  2. descubre authorization server
        ▼
 Supabase Auth OAuth 2.1  ── DCR ──► cliente registrado
        │  3. redirige al usuario
        ▼
 andromeda.legal/.lovable/oauth/consent   (UI de Andromeda)
        │  4. aprueba
        ▼
 access_token (1h) + refresh_token  ──►  POST /functions/v1/mcp
                                              │ verifica issuer + audiencia
                                              ▼
                                        tool handler
                                              │ Bearer del usuario
                                              ▼
                                        Postgres con RLS
```

## Fases

**Fase 0 — Desbloqueo (sin esto nada conecta)**
- Migrar signing keys a ES256 y verificar que el JWKS publica una clave asimétrica.
- Endurecer la ruta de consentimiento: que `/auth?next=...` devuelva al usuario a la URL de consentimiento tras email/password, tras signup (`emailRedirectTo`) y tras Google (`redirect_uri`) — hoy es el fallo más común y silencioso.
- Arreglar `work_item_estados` → `work_item_publicaciones`.

**Fase 1 — Catálogo de tools (lectura)**
Sobre las 3 existentes, añadir: `get_user_context`, `list_actuaciones`, `list_publicaciones`, `get_estados_hoy`, `get_actuaciones_hoy`, `list_deadlines`, `list_clients`, `get_client`. Reglas transversales: filtrar `deleted_at`, respetar la semántica ratificada de "hoy" (`fecha_fijacion` en America/Bogota), no exponer términos en `PENDING_REVIEW` como si estuvieran activos, límites de página duros, salida compacta (`content` en texto + `structuredContent`).

**Fase 2 — Escritura mínima**
`add_note` con `readOnlyHint:false`. Nada de eliminar, reclasificar ni cambiar lifecycle vía MCP en esta etapa — se mantiene la regla de no hard-delete y de confirmación humana. `add_hearing` queda para una tanda posterior.

**Fase 3 — Superficie de usuario**
- `/connect`: página pública con la URL del servidor e instrucciones por cliente (Claude, ChatGPT, Cursor).
- `/settings/connections`: lista de aplicaciones autorizadas, última conexión, y revocación. Requiere una tabla propia (`mcp_connection_log`) alimentada por las tools, porque el registro de clientes vive en el authorization server; la revocación se hace contra Supabase Auth.

**Fase 4 — Verificación**
Conexión real desde Claude, prueba de aislamiento con dos usuarios distintos (usuario A no ve expedientes de B), y confirmación de que ninguna tool referencia service role.

## Detalles técnicos

- Toda tool nueva vive en `src/lib/mcp/tools/<nombre>.ts` y se registra en `src/lib/mcp/index.ts`; el edge function se regenera solo y hay que **desplegarlo** en cada cambio.
- Tras cada cambio del MCP hay que regenerar el manifiesto (`.lovable/mcp/manifest.json`) para que el panel de integraciones y el catálogo de conectores queden al día.
- Nada de lecturas de env ni I/O en el top level de `index.ts` ni de las tools: rompe el cold start y la extracción del manifiesto.
- Textos de tools: título y descripción en español (los ve el Doctor y el modelo), identificadores y código en inglés.

## Lo que NO se hará (y por qué)

- Tablas propias de `oauth_clients` / `oauth_tokens`: las provee el authorization server.
- Segundo endpoint `mcp-public`: duplica superficie de auditoría sin ganancia.
- Scopes OAuth de dominio: no soportados por este emisor; se sustituyen por RLS + catálogo de tools.
- `/.well-known/mcp.json`: ningún cliente relevante lo consume.
