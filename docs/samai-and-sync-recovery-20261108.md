# Recuperación y vigilancia de sincronizaciones — 8 de noviembre de 2026

Se publicaron las funciones `atenia-ai-supervisor`, `atenia-daily-report`,
`scheduled-daily-sync`, `fallback-sync-check`, `atenia-ai-autopilot` y, por
separado, `sync-by-work-item` desde el código del proyecto. La herramienta de
despliegue no permite comparar el paquete previo en producción. Se verificó el
arranque de cuatro funciones mediante comprobaciones sin trabajo externo.

El intento de actuaciones del asunto `05001333301020230019900` leyó SAMAI pero
falló con HTTP 521 al leer actuaciones guardadas, coincidiendo con un reinicio
de PostgreSQL. No se atribuye la causa del reinicio. Tras cerrar ese intento
como fallido con evidencia y publicar la lectura compacta de identidades,
una lectura controlada del feed almacenado de SAMAI reconoció 76 de 76
actuaciones sin insertar duplicados. La observación de la fuente fue a las
02:33:45 de Bogotá; la incorporación se comprobó a las 10:36. Se cerró el
reintento previo con una copia del registro de cola en `sync_retry_outcomes`.

El asunto `05001233300020240115300` tenía un intento sin resultado final desde
las 04:00, anterior al mismo reinicio. El intento se cerró como interrumpido,
sin atribuir la causa, y la lectura almacenada reconoció 147 de 147 actuaciones
sin insertar duplicados. La observación de la fuente fue a las 02:41:52 de
Bogotá; la incorporación se comprobó a las 10:45. Su reintento diferido quedó
cerrado con copia de la cola en el historial de resultados. Las dos lecturas
completas no son una certificación de recuperación integral de documentos.

El detector SQL `alert_stranded_daily_updates_20261108` registra una advertencia
cuando un canal sigue iniciado sin resultado final más de 30 minutos. Es un
evento del sistema de la organización, consultable en el panel de salud y por
MCP; no envía correo, no altera el estado del asunto, no reabre la admisión ni
lanza consultas. Tiene un cron de 15 minutos y deduplica por asunto, canal, día
y traza. Si la fecha inicial no es válida utiliza la última modificación; no
declara que el proveedor haya fallado. La prueba con datos transitorios se
ejecuta dentro de una transacción revertida. Este vigilante no puede avisar
mientras la propia base de datos esté caída.

En la mañana del 8 de noviembre se observaron 15 de 15 lecturas completas de
la ventana vigente en SAMAI Estados. Publicaciones Procesales registró 17 de
53 lecturas exitosas para la ventana pública reciente, 3 fallidas y 33
pendientes; esas 17 lecturas no acreditaban el plan diario completo. A las
10:41, 38 de 68 asuntos judiciales activos y vigilados tenían una lectura de
actuaciones completa de su proveedor con observación del mismo día. Es un
corte parcial del día, no un indicador de disponibilidad ni una medición del
objetivo de 99 %. Las discrepancias de extracción y la cola de reintentos
requieren seguimiento.

Para revertir solo el detector, ejecutar
`supabase/release/stranded_daily_update_alert_rollback_20261108.sql`; conserva
el historial de alertas y no modifica asuntos. Para la lectura compacta de
identidades, seguir el orden de reversión de `docs/samai-identity-load-20261108.md`.
