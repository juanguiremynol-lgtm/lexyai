# Alerta pp-sync-job: hallazgos de lectura y corrección mínima propuesta

No se editó, publicó ni invocó nada. Solo se leyeron archivos y datos ya guardados.

## 1. Registros existentes (04-nov, 07:10–10:40 UTC)
- El visor de registros no devuelve ninguna entrada de `sync-publicaciones-by-work-item` ni de `process-retry-queue` en esa ventana, porque ya está fuera de lo que conserva. No se pueden entregar los errores exactos desde ahí.
- Lo que sí está guardado es la línea de tiempo de sincronización (07:00–11:00 UTC):

| status | error_code | provider | filas |
|---|---|---|---|
| pending_upstream | PENDING_UPSTREAM | unknown | 193 |
| deduplicated | DAILY_UPDATE_ALREADY_STARTED | unknown | 74 |
| error | PROVIDER_UNRESOLVED | unknown | 35 |
| skipped | PROVIDER_UNRESOLVED | unknown | 4 |
| success | PROVIDER_UNRESOLVED | unknown | 3 |
| success / error | null / PROVIDER_ERROR | cpnu | 3 |

- Todas las filas tienen `deploy_sha=unset`. Las 35 filas de error coinciden con los 35 ítems FAILED del monitor, pero perdieron su causa real (EXTRACCION_DOCUMENTO_NO_VERIFICADA, PORTAL_TIMEOUT, etc.).
- La correlación por UUID debe hacerse uniendo `estados_monitor_run_items` (motivo real) con la línea de tiempo por `work_item_id` + `sync_run_id`/tiempo. Es el primer paso de la validación.

## 2. Acceso a Cloud Run pp-sync-job
- El código no tiene ninguna ruta, credencial ni capacidad documentada para leer el historial o los registros de Cloud Run (búsqueda sin resultados). Las únicas credenciales GCP que conoce el proyecto son las claves de las API de lectura de los proveedores.
- **Límite declarado:** desde aquí no hay acceso autorizado a esos registros. Hace falta que Juan o Codex los lean desde la consola de GCP.

## 3. Causa por capa
**Demostrada (código y datos):**
- `_shared/syncTimeline.ts` (líneas 155–211):
  - Toma el proveedor solo de `provider_used`/`provider`. Ignora `backend_trace` y `provider` anidados, y por eso escribe `unknown`.
  - Toma la causa solo de `error_code`/`code`. Ignora `reason`, `errors[]`, `result_code` y `failure_reason`. Además, cuando el proveedor es `unknown`, el insert pone `PROVIDER_UNRESOLVED` por defecto (línea 80), incluso en las filas `success` (3 casos).
- `DEPLOY_SHA` sale de una variable de entorno que no existe (`?? "unset"`, línea 27). Ninguna publicación la define, así que el valor `unset` no es una regresión de despliegue.

**Demostrada (datos del monitor):**
- 35 de 53 fallos son negativas o parciales legítimas del lado PP/GCP: documento no verificado, OCR, contradicciones de planilla, autor no resuelto. Los 8 PORTAL_TIMEOUT de hoy y los 31 PORTAL_HTTP_502 del 3-nov vienen del portal. No son un defecto del consumidor.

**Hipótesis (sin verificar):**
- Los 193 pending_upstream y 74 deduplicados no convergen porque:
  - el límite diario (correcto) difiere los reintentos hasta el día siguiente;
  - los fallos documentales son deterministas, así que reintentar el mismo día no los cambia;
  - un certificado `VENTANA_PUBLICA` con `consulta_completa_plan_diario=false` no satisface el plan diario. Esto es correcto: no debe contarse como cobertura diaria. Hay que confirmarlo leyendo la decisión de reintento en `estadosMonitor.ts` y `process-retry-queue`.
- La causa de cada fallo de pp-sync-job en Cloud Run no se puede determinar sin sus registros.

## 4. Corrección mínima propuesta (no implementada)
Solo trazabilidad. Sin cambios en huellas, historia, límites diarios ni cobertura.
1. En `syncTimeline.ts`:
   - Proveedor: usar, en este orden, `provider_used`, luego `provider`, luego `backend_trace.provider`/`backend_trace.source`.
   - Causa: usar, en este orden, `error_code`, `code`, `result_code`, `reason`, `failure_reason` y luego el primer `errors[].code`.
   - No asignar `PROVIDER_UNRESOLVED` a filas `success`.
   - Guardar `backend_trace.alcance` y `consulta_completa_plan_diario` en `metadata`, sin cambiar el estado.
2. Un `VENTANA_PUBLICA` con plan diario incompleto queda como `partial`, nunca como `success` de cobertura diaria.
3. Definir el secreto `DEPLOY_SHA` en cada publicación, o registrar la huella de origen. Esto requiere tu autorización, porque toca secretos.
4. Prueba Deno dirigida: respuestas sintéticas con `backend_trace`, `reason` y `errors[]`, y un éxito sin proveedor. Comprobar el proveedor, la causa y que no aparezca PROVIDER_UNRESOLVED en un éxito.
5. Validación de solo lectura después del despliegue: comparar las filas de la línea de tiempo del siguiente ciclo ordinario con `estados_monitor_run_items`. Las causas deben coincidir en 1:1 y no debe haber un `success` nuevo de cobertura.
6. Funciones a republicar: el wrapper es compartido. Afecta a todas las funciones que usan `withSyncTimeline`, así que hace falta decidir si se publican solo las dos funciones PP o todas.

## 5. Huella del 2-nov (3b7c79a0…2f49)
- Ya no está vigente. `index.ts` actual tiene SHA `e7d7901d…2de6`, que es la publicación posterior de 1799308f/1192f51f, y `ppExplicitPublicationDates.ts` se mantiene en `e8ba0b52…2a`. La lógica del 2-nov sigue incluida en el archivo, pero esa huella de artefacto fue reemplazada.
- No se pudo obtener desde aquí el hash del artefacto publicado ahora. La huella anterior se toma del registro de la última publicación.

## Decisiones pendientes
- ¿Se aprueba la corrección del punto 4?
- ¿Qué funciones se republican?
- ¿Se autoriza definir `DEPLOY_SHA`?
- ¿Quién lee los registros de Cloud Run pp-sync-job?
