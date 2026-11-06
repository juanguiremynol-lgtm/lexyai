# Reparación acotada de la programación diaria — 6 de noviembre de 2026

El trabajo `daily-sync` (id 66) seguía programado para las 12:00 UTC, pero
enviaba una identidad anónima a `scheduled-daily-sync`. La función exige una
identidad interna. Una comprobación de salud, que no consulta proveedores,
reprodujo HTTP 401 con la identidad configurada y HTTP 200 con la credencial
interna. Que pg_cron informara una fila procesada solo acreditaba el envío
asíncrono de la petición, no la ejecución completa del trabajo. El registro
`auto_sync_daily_ledger` no tenía entradas posteriores al 21 de octubre.

Se aplicó [daily_sync_cron_auth_20261106.sql](../supabase/release/daily_sync_cron_auth_20261106.sql).
Conserva el mismo trabajo, horario y estado activo; obtiene la URL y la
credencial de Vault al ejecutar, y concede tiempo suficiente para el presupuesto
del trabajo. Una nueva comprobación de salud con la misma identidad devolvió
HTTP 200. No se ejecutó manualmente una corrida de cartera ni una extracción.

La próxima ejecución de Andrómeda es el 7 de noviembre a las 07:00 de Bogotá.
Su resultado completo, las continuaciones y la incorporación por asunto deben
verificarse después de esa hora. Antes de la corrección había dos admisiones de
actuaciones `STARTED` del día sin cierre; no se alteraron ni se asumió que el
trabajo anterior estuviera terminado.

La política de Cloud Monitoring de SAMAI sigue siendo un asunto separado: su
métrica puede contar una recuperación selectiva como una corrida diaria. Para
una reversión de emergencia que evite iniciar nuevos trabajos, desactivar el
job con `cron.alter_job(job_id := 66, active := false)` y revisar el historial y
la configuración antes de reactivarlo. No se registran credenciales en este
documento ni en el archivo SQL.
