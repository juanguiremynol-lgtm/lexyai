# Auditoría 25-nov-2026: fallo de scheduled-alert-evaluator

## Causa
Corrida 2026-11-25 12:40 UTC: 45 tareas fallidas, 0 alertas, error `cannot delete from scalar`.
Las tres llamadas a `public.insert_notification` (audiencia, tarea vencida, copia al propietario) enviaban
`p_metadata: JSON.stringify({...})`. El parámetro es `jsonb`; un string se convierte en escalar jsonb y
`p_metadata - 'html' - ...` falla. Ningún otro productor del repositorio serializa `p_metadata`.
`emails_failed=45` no acreditaba intentos de correo: esta función no envía correos.

## Corrección (sin migración ni cambios de filas)
- `supabase/functions/scheduled-alert-evaluator/payloads.ts` (nuevo): constructores puros de argumentos; `p_metadata` es objeto.
- `index.ts`: usa los constructores; la copia al propietario ahora registra error/aceptación (antes se ignoraba).
- Observabilidad (`email_stats`): `notification_requests_accepted`, `notification_requests_failed`; `emails_sent=0`,
  `emails_failed=0` (claves conservadas por compatibilidad). `hearing_alerts_created`/`task_alerts_created` conservan
  su nombre pero cuentan solicitudes aceptadas: `insert_notification` devuelve void y puede omitir la inserción por
  preferencias o deduplicación.
- Preferencias, deduplicación, destinatarios y permisos sin cambios. No se tocó SQL, cron ni scrapers.

## Pruebas
`bunx vitest run src/test/scheduled-alert-evaluator-payloads.test.ts` → 5/5: objeto (no string) en las tres ramas,
sin doble codificación, claves de dedupe, destinatarios, contadores sin afirmar correos ni inserciones.
`deno check index.ts` OK. No se ejecutó el evaluador ni se enviaron comunicaciones.

## Despliegue
`scheduled-alert-evaluator` desplegada con la herramienta administrada (2026-11-26 ~00:01 UTC),
source_sha256 `2c5f6876dff309fde50bf334ff9e621dd8a2ae99cf31e05ede535a366d3ccea5`. Base: c7f55284.
Pendiente: confirmar en la próxima corrida programada (12:40 UTC) error=0 en el trazo.
