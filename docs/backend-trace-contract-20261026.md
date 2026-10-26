# Entrega técnica del backend público — 26/10/2026

Base de aplicación preservada: `f1945721446950289fcd37b3775aea05669cf229`. Este cambio es sólo documentación: no despliega funciones, interfaz, MCP, migraciones, cron ni reglas de autenticación. La matriz con asuntos y evidencias permanece en el repositorio privado del backend, rama `fix/scraper-traceability-20261026`, carpeta `docs/audits/20261026/`.

## Contratos ya desplegados

- PP API `publicaciones-procesales-api-00082-xez`, fuente `96b6cbb`. Una publicación por estado puede contener varias entradas del mismo radicado, incluso en el mismo día. Se preserva un estado con varias filas: no deduplicar por fecha/título, ni convertir cada fila en un estado diferente. Los localizadores de artículo/página/tabla/fila y la identidad de origen son relevantes.
- Una fila de planilla no acredita el contenido decisorio de una providencia. El PDF del estado o del paquete es contexto; la copia individual requiere correspondencia acreditada. No presentar como auto cautelar la copia del admisorio ni una mención incidental a cautelares.
- `recuperacion_documental_completa` es nullable: sin inventario evaluable, `null` y estado `no_evaluada`; con documentos pendientes, `false`; sólo la evidencia completa permite `true`. Consulta terminada no equivale a recuperación completa.
- `trazabilidad_id`, `backend_run_id` y `backend_new_events` permiten correlación. Las respuestas parciales permanecen parciales; un lookup terminado no se normaliza siempre a éxito. `CASE_QUERY_SUMMARY` registra despacho, ventana, artículos y pendientes sin credenciales.
- SAMAI reader `samai-read-api-00019-kix`, fuente `b112352`: `fuentes_frescura.expediente` y `.estados` separan `ultimo_intento`, `ultima_consulta_exitosa`, `ultimo_resultado`, `ultimo_error_codigo` y `consulta_exitosa_ultimo_intento`. Un éxito de Estados no acredita frescura de Expediente.
- `PUBLIC_SESSION_HTTP_403` significa rechazo observado al iniciar la sesión pública. No equivale a expediente privado o falta de vinculación personal. Un 401 de descarga tampoco permite inferirlos por sí solo.
- Una referencia a copia vacía conserva el original y sus asociaciones con `gcs=false`, `descarga_estado=no_verificada` y error `stored_pdf_invalid`. No degradar ese fallo conocido a «lectura no registrada» ni ofrecerlo como PDF comprobado por conservar una URL.

## Incidencias de aplicación para conciliar

1. `work_item_sync_timeline` registra rechazos `CALLER_UNAUTHORIZED` antes del proveedor, con `provider=none`. Identificar el caller y la configuración/header realmente usados; no está demostrada la causa específica del desacuerdo. No debilitar guards ni rotar una clave unilateralmente. Registrar tipo de caller, correlación y resultado sin valores secretos. Un rechazo previo puede no tener fila en `external_sync_runs`.
2. `process-retry-queue` consume PUB_RETRY y ACT_SCRAPE_RETRY; el cron real es horario en una franja y una ejecución nocturna, no cada dos minutos como dice un comentario. El límite de cinco tareas y llamadas largas dejan primeras consultas pendientes. Garantizar selección justa, plazo acotado y resultado durable al agotar; los transitorios no deben aplazarse indefinidamente sin límite global.
3. `atenia-cron-watchdog` usa `work_item_sources` heredado y escribe otra cola. Hay asuntos con inscripción canónica habilitada sin fila heredada. Verificar recuperación de primera consulta sobre el contrato canónico, sin crear nuevas fichas ni afirmar que el watchdog actual drena `sync_retry_queue`.
4. Mantener separadas fecha de acto, fecha de registro/comunicación y fecha de publicación. Una comunicación que anuncia un acto posterior no reemplaza ese acto positivo. La etiqueta `fuente=tabla_estado` es tipo de evidencia, no una plataforma desconocida.
5. La extracción de agenda pertenece a la aplicación (`_shared/hearingExtractor.ts` y `sync-by-work-item`), no al scraper SAMAI. Se preservan las correcciones multisesión y sus límites del main actual. Archivo leído no equivale a clasificación ejecutada. No generar audiencias duplicadas para suplir una falta de proyección.

## Límites y verificación pendiente

Los resultados backend se comprobaron en almacenamiento y en ambos lectores PP, con repetición sin nuevas filas. No se certifica desde esa prueba la incorporación posterior a la aplicación ni los botones de interfaz. Las pruebas locales simuladas están separadas de ejecuciones reales en el informe privado. No se modificaron cron, Vault, términos, etapas, identidades, alertas ni el histórico SAMAI excluido.
