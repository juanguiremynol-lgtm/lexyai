

## Plan: Arreglar `Marcar atendido` + resolver alertas de términos

### Problema confirmado

En la consola/red:

```
PATCH https://andromeda-read-api-…/terminos/7/atender
Error: Failed to fetch
```

`GET /terminos` y `GET /novedades` funcionan, pero el `PATCH` falla porque el servidor `andromeda-read-api` no responde al **preflight CORS (OPTIONS)** desde el origen del navegador. El método PATCH + `Content-Type: application/json` siempre dispara preflight. El navegador lo bloquea antes de enviar el cuerpo, por eso aparece como "Failed to fetch" sin status code.

Adicionalmente, hoy al marcar atendido **no se resuelven** las alertas `TERMINO_CRITICO` / `TERMINO_VENCIDO` en `alert_instances` que generó el cron `sync-terminos-alertas` para ese mismo término.

### Cambios

#### 1. Nueva edge function proxy: `andromeda-terminos-proxy`

Mismo patrón que el resto de proxies CORS del proyecto. Hace el `PATCH` server-side al `andromeda-read-api` (sin restricciones CORS) y de paso ejecuta la resolución de alertas, todo en una sola llamada atómica desde el cliente.

Endpoint: `POST /functions/v1/andromeda-terminos-proxy`

Body:
```json
{ "termino_id": 7, "radicado": "05001…00", "notas": "…" }
```

Lógica:
1. Verificar JWT del usuario (rechazar si no autenticado).
2. Llamar `PATCH https://andromeda-read-api-…/terminos/{termino_id}/atender` con `{ notas }`. Capturar status + body.
3. Si el PATCH retorna 2xx (o `ok:true` en payload):
   - Resolver alertas en el alcance del usuario:
     ```sql
     UPDATE alert_instances
     SET status = 'RESOLVED',
         resolved_at = now()
     WHERE alert_type IN ('TERMINO_CRITICO','TERMINO_VENCIDO')
       AND status NOT IN ('RESOLVED','DISMISSED','CANCELLED')
       AND organization_id = <org del usuario>
       AND entity_id IN (
         SELECT id FROM work_items
         WHERE radicado = <radicado normalizado>
           AND organization_id = <org del usuario>
           AND deleted_at IS NULL
       )
     ```
   - Opcional: filtrar también por `payload->>'id' = termino_id::text` para no resolver términos hermanos del mismo expediente. Decisión: resolver **todas** las alertas del work_item por término atendido, ya que la API externa no expone múltiples términos abiertos del mismo radicado simultáneamente y simplifica el modelo.
4. Responder siempre `200` con shape `{ ok: boolean, error?: string, alerts_resolved: number, upstream_status: number }` (patrón de error envelope ya conocido en el proyecto).

Config: `verify_jwt = true` (default ok); usar `SUPABASE_SERVICE_ROLE_KEY` solo dentro de la función para el UPDATE. CORS headers estándar `*` en respuesta + handler `OPTIONS`.

#### 2. Actualizar `src/lib/services/andromeda-terminos.ts`

Reemplazar `atenderTermino` para invocar el proxy vía `supabase.functions.invoke("andromeda-terminos-proxy", { body: {...} })` en lugar del fetch directo. Pasar `radicado` además de `id` (el componente ya lo tiene en `TerminoItem`).

Nuevo shape del return: `{ ok: boolean; alerts_resolved: number; error?: string }`.

#### 3. Ajuste menor en `EstadosHoy.tsx`

- En `atenderMutation.mutationFn` pasar también `radicado`.
- En `onSuccess`:
  - Toast "Término marcado como atendido — N alertas resueltas" (si `alerts_resolved > 0`).
  - Invalidar también `["alerts"]` / `["notifications"]` para refrescar el badge de la campana.
- En `onError`: usar `error.message` del envelope si viene.

### Detalles técnicos

- **Por qué proxy y no arreglar CORS upstream**: el `andromeda-read-api` está fuera del repo Lovable. Un proxy server-side es la solución estándar y ya implementada para casos análogos (`api-colombia-proxy`, `egress-proxy`).
- **Idempotencia**: si el usuario hace doble click, el segundo PATCH puede devolver `ok:true` (ya atendido) o un error suave; el UPDATE de alertas es idempotente (filtra por `status NOT IN RESOLVED…`).
- **Scope de seguridad**: el UPDATE se restringe a `organization_id` del JWT para evitar resolver alertas de otra organización aunque el `termino_id` sea adivinable.
- **Normalización radicado**: usar el mismo cleaner que `judicial-data-normalization-standards` (trim + solo dígitos) antes del lookup en `work_items`.
- **Error envelope**: el proxy nunca lanza 5xx al cliente — siempre 200 con `ok:false` + `error` para que `supabase.functions.invoke` no descarte el body.

### Fuera de alcance

- No se modifica `sync-terminos-alertas` (la generación de alertas sigue igual).
- No se cambia el shape del endpoint upstream.
- No se añade reintento automático ni cola — un fallo de upstream se reporta al usuario y queda para reintento manual.

