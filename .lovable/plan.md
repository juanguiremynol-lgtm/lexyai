# Outlook + Graph → Work Items (auditoría + plan por fases)

## FASE 1 — Auditoría del andamiaje existente

### Inventario de tablas email (recurso → estado → qué hace)

| Recurso | Filas | Estado | Qué hace hoy |
|---|---|---|---|
| `emails` | 0 | **Muerto** | Modelo legacy de filings antiguos. No hay escrituras vivas. |
| `email_threads` | 0 | **Muerto** | Igual, legacy de filings. |
| `court_emails` | 0 | **Esqueleto** | Referenciada por `resolve-courthouse-email` y `backfill-courthouse-emails` (pipeline de resolución de email de juzgado), pero sin datos. |
| `work_item_email_events` | 4 | **Vivo mínimo** | Escrito por `dispatch-update-emails`/`send-signing-email` para trazar envíos salientes vinculados a un WI. **No** almacena entrantes. |
| `integrations` | 1 (ICARUS DISCONNECTED) | **Vivo (genérico)** | Tabla ya lista para OAuth: tiene `secret_encrypted`, `expires_at`, `last_sync_at`, `status`, `metadata`. **Se puede reutilizar tal cual para MICROSOFT_GRAPH** añadiendo enum. |
| `org_integration_settings` | 0 | **Esqueleto** | Config por-org. Sin usos activos relevantes a email entrante. |
| `system_email_mailbox` / `system_email_messages` / `system_email_settings` / `system_email_setup_state` / `email_provider_config` / `platform_email_actions` | 0–7 | **Vivo pero de otro scope** | Todo esto es el **buzón institucional `info@andromeda.legal`** (consola de plataforma, Resend/SES/etc). No es email personal del abogado. **No mezclar** con esta feature. |
| `email_outbox` | 116 | **Vivo** | Cola saliente transaccional (auth, notificaciones). No relevante. |
| `inbound_messages` / `inbound_attachments` / `message_links` | 0 | **Esqueleto FUERTE — reutilizable** | Definidos en `src/types/email.ts` y en `src/components/email/` (`EmailInbox`, `EmailListPane`, `EmailDetailPane`, `EmailLinkDialog`, `EmailMessageCard`, `EntityEmailTab`, `EmailInboxPage`). La UI de bandeja de revisión + vínculos por confianza YA está construida en frontend. Falta el productor (ingesta). |

### 2. OAuth Microsoft Graph — ¿existe?
**No existe nada.** Búsqueda de `MS_CLIENT`, `graph.microsoft`, `outlook` en `supabase/functions`: solo aparece `outlook.com` como dominio genérico en `verify-generic-email`, y `graph.facebook.com` (WhatsApp). **Hay que construir el flujo OAuth Graph desde cero**, pero `integrations` sirve de tabla base.

### 3. `email_linking_enabled` (true en 40 WIs)
**Flag semi-huérfano.** Solo lo lee `supabase/functions/inbound-email/index.ts` para filtrar candidatos. Como esa función solo recibe webhooks Resend (que no hay), el flag hoy no dispara nada. Está listo para que esta feature lo use.

### 4. Motor de correlación correo→WI — ¿existe?
**Sí, un primer esqueleto vivo** en `supabase/functions/inbound-email/index.ts` (`findLinkCandidates`):
- Extrae radicados del texto y los matchea contra `work_items.radicado` normalizado sin guiones (conf 0.95, auto).
- Match por email del cliente en from/to/cc (conf 0.9, auto).
- Match por `court_email == from_email` (conf 0.75, sugerido).
- Persiste en `inbound_messages` + `message_links` con status `AUTO_LINKED` / `LINK_SUGGESTED`.

**Gap vs visión del Doctor:** hoy 1 factor = auto-link. La regla de "≥2 factores" no está implementada. El adapter solo entiende webhook Resend, no pull Graph. `court_emails` y `work_item_email_events` sí existen pero no cierran ciclo con esta bandeja.

### 5. LLM para extracción del cuerpo — ¿existe?
**Sí, reutilizable.** `callGeminiViaEdge` en `src/lib/services/atenia-ai-engine` está usado por `src/lib/platform/email-ai-service.ts` (draft, triage, clasificación de emails de plataforma). Edge functions Gemini vivas: `atenia-ai-autopilot`, `atenia-ai-supervisor`, `hearing-ai-insights`, `provider-wizard-ai-guide`, `lexy-daily-message`. **Modelo Gemini vía Lovable AI Gateway ya cableado.** Se puede añadir un prompt específico "extraer fase procesal / términos / alertas" sin nueva infraestructura.

### Resumen ejecutivo Fase 1
- **Reutilizar completo:** `inbound_messages`/`inbound_attachments`/`message_links` (esquema + UI ya listos), `integrations` (OAuth tokens), correlador base de `inbound-email`, stack Gemini existente.
- **Descartar / no tocar:** `emails`, `email_threads`, buzón institucional (`system_email_*`, `email_provider_config`, consola `info@andromeda.legal`) — es otro dominio.
- **Construir nuevo:** OAuth Microsoft Graph, worker pull Graph (Mail + Calendar + Junk), regla 2-factores, extractor IA de cuerpo, detección administrativa, botón descarga PDF on-demand, pantalla de ajustes por usuario.

---

## FASE 2 — Plan por fases

### Fase A — Conexión OAuth Microsoft Graph (por-usuario, sin código)
**Alcance:** Auth Code + PKCE para Microsoft identity platform (multi-tenant `common`), tokens por usuario, revocable.
- **Scopes exactos (solo lectura, offline):**
  - `offline_access` (refresh token)
  - `User.Read` (identidad)
  - `Mail.Read` (Inbox + Junk son carpetas del mismo scope)
  - `Calendars.Read`
  - `MailboxSettings.Read` (zona horaria del calendario)
- **Secrets que el Doctor debe pegar (App Registration en Entra ID):**
  - `MS_GRAPH_CLIENT_ID`
  - `MS_GRAPH_CLIENT_SECRET`
  - `MS_GRAPH_TENANT` = `common`
  - Redirect URI = `https://qvuukbqcvlnvmcvcruji.supabase.co/functions/v1/ms-graph-oauth-callback`
- **Tablas:** reutilizar `integrations` (añadir valor `MICROSOFT_GRAPH` al enum de provider); `secret_encrypted` = refresh_token cifrado; `metadata` = `{ upn, tenant_id, scopes, connected_at }`; `expires_at` = expiración access token.
- **Edge functions nuevas:** `ms-graph-oauth-start` (devuelve URL de consentimiento), `ms-graph-oauth-callback` (canjea code→tokens, cifra, guarda).
- **Riesgos:** secreto profesional del abogado — el consentimiento debe mostrar explícitamente scopes leídos; revocación en 1 click debe borrar refresh_token del registro.
- **Config manual del Doctor:** App Registration en portal.azure.com + pegar 3 secrets.

### Fase B — Ingesta ligera (pull, no store)
- **Edge function nueva:** `ms-graph-sync-mailbox` (por usuario). Estrategia: **Microsoft Graph delta query** sobre `/me/mailFolders/inbox/messages/delta` y `/me/mailFolders/junkemail/messages/delta` — solo trae mensajes nuevos, guarda `deltaLink` en `integrations.metadata`.
- **Campos que trae Graph por mensaje:** `id`, `subject`, `from`, `toRecipients`, `ccRecipients`, `receivedDateTime`, `bodyPreview` (primeros 255 chars), `hasAttachments`, `conversationId`, `webLink`, `internetMessageHeaders`. **Sólo se descarga el `body.content` completo bajo demanda** (siguiente llamada per-message) cuando corresponda para extracción IA; **no se persiste** — se pasa a Gemini en memoria y se descarta.
- **Persistencia mínima en `inbound_messages`:** `source_provider='MS_GRAPH'`, `source_message_id`, from, to/cc, subject, `body_preview` (los 255 chars de Graph, no el cuerpo completo), `date_header`, `thread_id=conversationId`, `raw_payload_hash`. `text_body`/`html_body` = **NULL a propósito**.
- **Filtro de alcance (privacidad máxima):** por defecto solo procesar mensajes cuyo remitente, asunto o `bodyPreview` matchee patrones judiciales/administrativos (regex radicado, dominios `.gov.co`, `rama judicial`, `notificacionesjudiciales@`, `secretaria`, nombres de despacho de la directory `courthouse_directory`, o nombre/email de un cliente registrado). Todo lo demás se ignora sin llegar a `inbound_messages`. Doctor puede subir a "todo el buzón" con un toggle en ajustes.
- **Cadencia:** default cada 15 min por usuario conectado, más un barrido consolidado al cron 07:00 ya existente. Configurable por-usuario.
- **Riesgos:** cuota Graph (10k req/10min/app) — delta query minimiza; secreto profesional — filtro por default estrecho.

### Fase C — Correlador de 2 factores
- Extender `findLinkCandidates` (o crear `_shared/emailCorrelator.ts`) con **scoring por factor**:
  1. Radicado normalizado (quita `-`, `.`, espacios) contra `work_items.radicado`.
  2. Despacho/juzgado: match del `authority_name`/`court_email` contra from/subject.
  3. Fecha: `receivedDateTime` cercano a `filing_date` / `hearing_date` / plazo activo.
  4. Partes: fuzzy match de `demandantes`/`demandados` en asunto/preview.
  5. Cliente: nombre o email de `clients` en from/to/cc.
- **Regla ≥2 factores distintos → `AUTO_LINKED`** en `message_links` (conf ≥0.8). 1 factor → `LINK_SUGGESTED` (bandeja de revisión). 0 → si passó el filtro de Fase B, queda en `inbound_messages` sin link para revisión.
- Reutiliza tablas `message_links`, `inbound_messages`. Escribe traza en `work_item_email_events` cuando auto-vincula.
- **UI ya lista:** `EmailInbox`, `EmailLinkDialog`, `EntityEmailTab` — solo hay que apuntarlas al feed real.

### Fase D — Extracción IA del cuerpo (Gemini, no persistir)
- **Edge function nueva:** `ms-graph-extract-body` — para un `inbound_messages.id` vinculado a un WI, hace fetch on-demand a Graph `/messages/{id}` (body completo), llama `callGeminiViaEdge` con prompt estructurado:
  - Salida JSON: `{ suggested_stage, detected_terms:[{tipo, plazo_dias, fecha_base}], alerts:[{severity, message}], summary_note }`.
- **Persistencia del resultado (no del cuerpo):**
  - `suggested_stage` → nueva fila en `work_item_stage_suggestions` (tabla ya existente).
  - `detected_terms` → `work_item_deadlines` (existe) + `work_item_reminders`.
  - `alerts` → `alert_instances` (existe).
  - `summary_note` → `work_items.notes` o nueva tabla `work_item_email_extractions(message_id, work_item_id, summary, model, created_at)` de una sola fila por mensaje (sin body).
- **Cero almacenamiento de cuerpo:** el `body.content` viaja Gemini→resultado y se descarta.
- Riesgo: coste tokens — llamar solo cuando `message_links.link_status='AUTO_LINKED'` o el usuario aprueba desde bandeja.

### Fase E — Detección de correos administrativos → propuesta de WI
- Mismo pipeline de Fase D pero cuando **no** hay match de radicado y el remitente/dominio es autoridad administrativa (`.gov.co`, `mintrabajo`, `superintendencia`, `dian`, `alcaldía`, `secretaría`, etc., lista curable) o Gemini clasifica el asunto como `PETICION_ADMIN`.
- Resultado: fila en `inbound_messages` marcada + entrada en la bandeja de revisión con acción **"Crear peticion/proceso admin desde este correo"** (prellena `NewProcess` wizard) o **"Vincular a WI existente"** (autocomplete sobre `work_items` tipo PETICION/PROCESO_ADMIN).
- Nada de auto-creación silenciosa: siempre requiere click del Doctor.

### Fase F — Adjuntos PDF (descarga on-demand, no store)
- `inbound_attachments` guarda solo metadatos: `filename`, `mime_type`, `size_bytes`, `content_hash` (opcional), y `storage_path=NULL`. Añadir columna `graph_attachment_id` y `graph_message_id`.
- **Edge function nueva:** `ms-graph-download-attachment` — recibe `{message_id, attachment_id}`, valida ownership, refresca access token si vence, hace stream de Graph `/messages/{id}/attachments/{aid}/$value` directo al response con `Content-Disposition: attachment`. **Nunca escribe a Storage.**
- UI: botón "Descargar PDF" en `EmailDetailPane` que llama la function con auth de Supabase. Link válido solo mientras hay sesión.

### Fase G — UI (ajustes + bandeja + WI)
- **Ajustes (`/settings/integrations` o nueva `IntegrationsSettingsPage`):**
  - Tarjeta "Outlook / Microsoft 365" con botón **Conectar** (abre `ms-graph-oauth-start`), estado (email conectado, última sync, próxima sync), botón **Desconectar** (revoca refresh token y borra `integrations` row).
  - Toggle "Ampliar barrido a todo el buzón" (default off).
  - Toggle "Sincronizar calendario también" (default on).
- **Bandeja de revisión:** ya existe `EmailInboxPage` + `EmailInbox` con tabs Pendientes/Vinculados/Todos — apuntar a `inbound_messages` real y añadir columna "Fuente: Outlook".
- **En el WI:** `EmailsTab` ya existe — mostrar mensajes con `message_links.entity_type='WORK_ITEM'`, un badge con score, y para cada uno: preview (255 chars), fecha, "Descargar adjuntos", "Ver en Outlook" (`webLink`).
- **Calendario:** función `ms-graph-sync-calendar` — matchea eventos por radicado en subject/body preview contra WIs, crea/updatea `hearings` (tabla existente) con `source='outlook'`; alerta si hay conflictos.

### Dependencias del Doctor
- Registrar app en Entra ID + pegar 3 secrets (Fase A). Todo lo demás activable desde UI.

### Riesgos transversales
- **Confidencialidad:** filtro estrecho por default (Fase B) + no-store de cuerpos (Fase B/D) + no-store de PDFs (Fase F).
- **Tokens Graph:** cifrado con la misma técnica que `integrations.secret_encrypted` hoy (revisar la existente antes de codear).
- **Cuota Graph + coste Gemini:** delta query + extracción IA solo tras auto-link.

---

**No se ejecuta nada hasta tu OK.** Confirmá si (1) reutilizo `inbound_messages`/`message_links` tal cual o querés esquema nuevo dedicado a Graph, (2) el filtro Fase B default estrecho te parece bien o preferís "todo el buzón desde el arranque", y (3) empezamos por Fase A o querés ver primero un mock de la pantalla de ajustes.
