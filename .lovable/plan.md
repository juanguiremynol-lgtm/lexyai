# Estado verificable: corrección CALLER_UNAUTHORIZED, colas y canal de consulta selectiva

Solo lectura. No se editan ni despliegan funciones, cron ni credenciales. No se crean ni eliminan asuntos, y no se tocan históricos, alertas ni términos.

## Lo que ya consta (registrado en docs/production-remediation-20261026.md)
- Causa: el reintento ACT de process-retry-queue llamaba a sync-by-work-item en modo `_scheduled` sin credencial explícita de servicio o cron. El guard lo rechazaba con 401, que se registraba como `CALLER_UNAUTHORIZED` con proveedor `none`. Ese 401 no significa "expediente privado".
- Corrección: `dispatchRetry` envía la identidad de servicio de forma explícita. process-retry-queue, atenia-cron-watchdog y detect-remision-succession exigen ahora un llamante privilegiado. La migración 0087 añade claims con lease token y resultados terminales durables.
- Funciones desplegadas el 2026-10-26 (SHA del bundle):
  - sync-by-work-item `3e4a048e…`
  - process-retry-queue `136de82a…` (revision `retry-fenced-20261026`)
  - atenia-cron-watchdog `7f9f4177…`
  - detect-remision-succession `fa76fcdf…`
- Pruebas reales: una llamada sin autorización recibió 401. Una llamada programada legítima recibió 200. El drenaje 1299 procesó 3 elementos: 1 SUCCESS, 1 PENDING_UPSTREAM y 1 EXHAUSTED.
- Pendiente de demostrar: la lectura posterior de `sync_retry_outcomes` para las filas terminales.

## Pasos de verificación (consultas de solo lectura)
1. Revisar los registros del 26 al 28 de octubre en `work_item_sync_timeline`. Contar los `CALLER_UNAUTHORIZED` antes y después del despliegue, separados por `invoker_function`. Confirmar que, después del despliegue, las ejecuciones programadas de las 05–13 y 18 UTC registran `auth_mechanism` y son aceptadas.
2. Revisar `sync_retry_queue` (profundidad por tipo y canal, intentos, la fila más antigua con `attempt=0`, claims vencidos) y `sync_retry_outcomes` (resultados terminales, incluidas las tareas 2eb8921a y 49af5c3c).
3. Comprobar el último estado y fecha de las funciones desplegadas con los registros y las cabeceras `revision` y `adapter_version`. No basta con el manifiesto.
4. Para los cuatro asuntos (Nicholls db1b4198, Esfinge f046908c, Sandra 6153c00f, Martha 5840084b), revisar la última línea de tiempo por proveedor y operación, el `trace_id`, la cola pendiente y las filas de publicaciones 1244/1247/1267, incluido el estado del PDF de la medida cautelar.
5. Comparar el censo de ACTIVE monitoreados y no monitoreados con lo informado por backend: 73 = 68 + 5.

## Mecanismo normal de consulta selectiva (a confirmar en el código)
- Disparo manual desde la ficha del asunto, con la sesión del propietario: sync-by-work-item valida `auth.getUser()`, aplica la puerta de re-scrape y su cooldown, y escribe la línea de tiempo con `trace_id`. Se puede fijar `X-Trace-Id` para correlacionar los pasos.
- Ruta programada: cron con `x-cron-key` → process-retry-queue → sync-by-work-item.
- No se hace curl directo al scraper ni se salta el guard.

## Entrega
Responder solo con el estado y el mecanismo, separando "verificado hoy", "verificado el 26 de octubre" y "pendiente". El contrato backend `aaa6e123` se tratará como referencia externa: no está en este checkout y no se afirmará que esté integrado.
