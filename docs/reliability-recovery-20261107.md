# Recuperación de vigilancia y resumen — 7 de noviembre de 2026

Todas las horas expresadas como hora local son de Bogotá. El resumen de las 08:00 no tenía ninguna corrida para el destinatario esperado; el vigilante independiente lo identificó a las 10:00 y el correo de alerta efectivamente salió. Los registros de pg_cron muestran actividad hasta las 07:00, ninguna ejecución entre las 07:01 y las 08:35, y un reinicio de PostgreSQL a las 08:32:30. Esto es consistente con que se perdieran los horarios de 07:20 y 08:00, pero no identifica la causa del reinicio.

La sincronización diaria de actuaciones de las 07:00 inició, pero su primera etapa quedó PARTIAL por presupuesto agotado; la continuación que empezó a las 07:02 permanece RUNNING sin cierre desde antes del reinicio. No se afirma una corrida completa ni se modifica el ledger para simularla.

## Resumen recuperado

Se ejecutó primero una prueba con `dry_run=true`, para el dueño afectado y la fecha 2026-11-07: respondió HTTP 200, un destinatario, cero fallos y dejó libre la fila del día. Después se solicitó una sola recuperación normal de ese mismo destinatario y fecha. `daily_digest_runs` y `email_outbox` registraron una fila cada uno, ambas SENT; Outlook confirmó la llegada. El intervalo quedó desde 2026-11-06 08:00:08 hasta 2026-11-07 19:10:24, hora de Bogotá. El estado SENT del outbox por sí solo no se usa como prueba de recepción; la comprobación independiente fue la bandeja de entrada.

## Lectores MCP

`mcp_freshness_public_status_20261107.sql` modifica únicamente la presentación del estado de cada intento en `mcp_list_freshness_issues` y `_mcp_feed_freshness`. Un registro con estado de éxito o vacío pero con error, proveedor ausente/no identificado o sin el veredicto de éxito atribuible aparece como `unverified`; no se cambia el registro histórico. `successful_check`, los agregados, los cursores y la autorización/RLS se conservan. El test SQL cubre 14 combinaciones; ambas funciones modificadas se compilaron primero en el esquema temporal. Las llamadas reales a `list_freshness_issues` y `list_updates` devolvieron `unverified` y `successful_check=false` para un registro real `PROVIDER_UNRESOLVED`; un éxito atribuible siguió siendo éxito. Los privilegios y el modo SECURITY INVOKER no cambiaron. El archivo de reversión conserva las definiciones previas exactas.

La marca `successful_check` de estos lectores comprueba el veredicto de la operación y la atribución; no constituye por sí misma un certificado de cobertura histórica ni de todas las fuentes.

## Corridas de estados

No existían snapshots de estados del 7 de noviembre. Se publicó el despachador `dispatch_missing_state_runs_20261107`, sin acceso para `anon` ni `authenticated`, con ensayo por defecto. Después de la prueba se solicitó una única siembra por canal: 53 asuntos PP y 15 SAMAI Estados. Una segunda llamada comprobó que no se enviaban nuevas solicitudes con snapshots ya existentes. SAMAI Estados terminó 15/15; PP seguía parcial al último control de esta nota, con fallos y pendientes que deben conservarse como tales. La aceptación HTTP del despacho no certifica que cada fuente haya sido leída ni que su cobertura sea completa.

El cron `andromeda-state-run-catchup-v1` ejecuta el despachador cada 20 minutos dentro de la ventana local permitida. Solo puede sembrar un canal sin snapshot del día, espera 19 minutos entre intentos y permite como máximo tres solicitudes diarias por canal. Se conservan la identidad del snapshot, los límites de extracción y las colas existentes. La reversión solo desprograma este respaldo; no elimina ni reinicia corridas. Su primera ejecución programada quedó registrada como terminada y no volvió a solicitar los snapshots existentes.

No se pidió a la IA de Lovable editar ni desplegar estos cambios. El proyecto de Cloud Run no es accesible desde la sesión local del propietario; sus corridas completas y los avisos de Monitoring requieren los registros de la cuenta administradora. Sigue pendiente decidir si un respaldo automático del resumen puede enviar correos atrasados a los demás usuarios que ya lo tienen activado.
