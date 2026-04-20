

## Plan: Edge Function `sync-terminos-alertas`

### Contexto
Crear un cron diario que consulta la API externa `andromeda-read-api/terminos`, filtra términos con `alerta ∈ {URGENTE, VENCIDO}` y `estado = PENDIENTE`, y genera alertas idempotentes en `alert_instances` para los dueños correspondientes.

### Resolución de `owner_id` (decisión clave)
La API de términos NO trae `owner_id`. Para cada término necesitamos saber a qué usuario(s) notificar. Estrategia: **buscar `work_items` por `radicado` normalizado** y crear una alerta por `owner_id` distinto. Si ningún `work_item` matchea ese radicado, el término se ignora silenciosamente (con log) — significa que ningún usuario lo está monitoreando.

### Cambio 1 — `supabase/functions/sync-terminos-alertas/index.ts` (nuevo)

Edge function Deno con CORS estándar y `verify_jwt = false` (corre en cron + admin-trigger).

**Flujo**:
1. `GET https://andromeda-read-api-486431576619.us-central1.run.app/terminos` → lista de términos.
2. Filtrar: `alerta ∈ {URGENTE, VENCIDO}` y `(estado || "").toUpperCase() === "PENDIENTE"`.
3. Para cada término:
   - Normalizar `radicado` (usar helper local trim/colapsar espacios; no requiere `radicadoUtils` de import path con alias).
   - Query: `SELECT id, owner_id, organization_id, workflow_type FROM work_items WHERE radicado = $1 AND deleted_at IS NULL`.
   - Para cada `work_item` resultante, llamar `createAlertIdempotentEdge(...)` con:
     - `alert_type`: `TERMINO_CRITICO` si `URGENTE`, `TERMINO_VENCIDO` si `VENCIDO`.
     - `severity`: `CRITICAL` si `prioridad === "CRITICA"`, `WARNING` si `prioridad === "ALTA"`, en otros casos `WARNING` (default conservador).
     - `entity_type`: mapear `workflow_type` del work_item a `AlertEntityType` (CGP→`CGP_FILING`, CPACA→`CPACA`, etc.); fallback `CGP_FILING`.
     - `entity_id`: `work_item.id` (UUID — la columna es uuid). El `radicado` se guarda dentro de `payload` y `fingerprint_keys`.
     - `title`: `termino.tipo_auto || "Término procesal"`.
     - `message`: `${termino.accion_abogado || "Acción requerida"} — Vence: ${termino.fecha_limite || "sin fecha"}`.
     - `payload`: `{ ...termino, source: "andromeda-terminos-api" }`.
     - `fingerprint`: MD5 vía `crypto.subtle` o `node:crypto` de `${radicado}:${termino.id}:${termino.fecha_limite}`. Se pasa como `fingerprint_keys.radicado/eventType/eventDate` para que el helper lo recomponga, **o** se inserta directamente con un `fingerprint` precomputado (más simple).
4. Insert directo en `alert_instances` con `ON CONFLICT (fingerprint) DO NOTHING` para idempotencia. Requiere `unique index` sobre `fingerprint` — si no existe, agregar migración (ver Cambio 3).

**Helper local en el archivo** (no importamos el cliente):
```ts
async function md5Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("MD5", data); // si MD5 no está disponible en Deno, usar SHA-256 truncado
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
```
Nota: Deno no expone MD5 vía SubtleCrypto. Usaremos **SHA-256** y tomaremos los primeros 32 chars (equivalente en colisión-resistance, sirve para dedup). Esto difiere del cliente Node, pero el `fingerprint` solo necesita ser estable dentro de esta función.

**Respuesta**: `{ ok: true, fetched: N, candidates: M, alerts_created: K, alerts_skipped_duplicate: D, no_owner: O }`.

**Service role**: usar `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS para insertar alertas en nombre de cualquier owner).

### Cambio 2 — Programar cron diario

Agregar en `supabase/functions/_shared/cronRegistry.ts` una nueva entrada:
```ts
{
  jobname: "sync-terminos-alertas-daily",
  label: "Sync Términos → Alertas",
  schedule_utc: "20 12 * * *",   // 07:20 COT (después del sync diario y antes del supervisor)
  schedule_cot: "07:20 COT",
  edge_function: "sync-terminos-alertas",
  role: "ALERTS",
  critical: true,
  expected_active: true,
  notes: "Lee /terminos y genera alertas TERMINO_CRITICO/TERMINO_VENCIDO para owners de work_items que matcheen radicado",
}
```

Y crear migración SQL que registre el cron job vía `cron.schedule(...)` con `net.http_post` al edge function (mismo patrón que el resto del registry).

### Cambio 3 — Garantía de idempotencia en DB

Verificar/crear índice único parcial sobre `alert_instances(fingerprint)` (probablemente ya existe; si no, migración:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_instances_fingerprint_unique
  ON public.alert_instances (fingerprint)
  WHERE fingerprint IS NOT NULL;
```

Esto permite usar `ON CONFLICT (fingerprint) DO NOTHING` en el insert desde la edge function, garantizando que reejecuciones del cron no dupliquen alertas para el mismo `(radicado, termino_id, fecha_limite)`.

### Cambio 4 — Trigger manual desde Admin (opcional pero recomendado)

Pequeño botón "Ejecutar ahora" en el panel de Cron Governance (si existe) que llame al endpoint. Fuera de alcance si no se pide explícitamente — solo dejo nota.

### Notas operativas

- **Términos sin radicado matcheable**: se loguea `console.warn` con `radicado` y se cuenta en `no_owner`. No se crea alerta huérfana.
- **Múltiples work_items con el mismo radicado** (caso colaborativo): se crea **una alerta por owner distinto**. El fingerprint incluye `organization_id || owner_id` implícitamente al ser parte del scope, pero como aquí decidimos por owner, lo añadimos al input del hash: `${owner_id}:${radicado}:${termino.id}:${termino.fecha_limite}`.
- **Campo `actions`**: se incluye `[{label: "Ver expediente", action: "navigate", params: {path: `/app/work-items/${work_item.id}`}}]` para deep-link.
- **No se altera la API externa** ni `alert-service.ts` cliente. Toda la lógica vive dentro del edge function.
- **Logging**: por término procesado: `radicado`, `termino_id`, `alerta`, `prioridad`, `owners matched`, resultado (`created` / `duplicate` / `error`).

### Fuera de alcance
- No se cambia `TerminoCard` ni `EstadosHoy.tsx`.
- No se generan emails directamente — el cron `dispatch-update-emails-5min` ya recoge las nuevas filas de `alert_instances` y aplica políticas de envío según `alert_preferences` del usuario.
- No se sincroniza el campo `notas` de la API hacia ningún lado.
- No se crea UI para forzar la ejecución manual.

