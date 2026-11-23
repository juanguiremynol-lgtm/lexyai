# Diagnóstico del procesamiento diario: 23 de noviembre de 2026

Corte de lectura: 23/11/2026 aproximadamente 15:14–15:18 America/Bogota (20:14–20:18 UTC). Este cambio se preparó sobre `main` `2a1d66296aee85c237ef29d7a043d90c0e3c3ed2`, en una rama aislada. No modifica datos productivos, programación, identidad de expedientes ni el MCP.

## Evidencia productiva

La cadena `scheduled-daily-sync` iniciada a las 10:20 Bogotá y sus dos continuaciones registró resultados parciales. Sus resúmenes indicaron 31, 20 y 6 asuntos procesados, respectivamente, con 9, 6 y 3 errores; esos contadores son etapas de ejecución, no cobertura judicial independiente. El encolado y el watchdog figuran `OK`, pero no certifican el resultado de los proveedores.

En `daily_source_attempts` para el 23/11 se observaron 78 filas: 41 `SUCCESS` y 12 `PENDING` de CPNU; 12 `SUCCESS` y 3 `PENDING` de SAMAI; 2 `SUCCESS` y 8 `PENDING` para tutelas. Las 23 pendientes tenían su siguiente intento vencido al corte y su última actualización entre 10:20 y 10:26 Bogotá. Son estados de esta tabla y fecha, no un denominador reconciliado de toda la cartera ni una medición de publicaciones.

Las 23 pendientes presentan `error_code=NETWORK_ERROR`, aunque `result.error` conserva causas diferentes, como `PROVIDER_NOT_FOUND`, `PARTIAL_SOURCE`, `POST_INGEST_EFFECTS_PENDING` y `DAILY_UPDATE_ALREADY_STARTED`. La implementación envolvía esas respuestas lógicas en excepciones genéricas; `runDailySourceAttempt` trataba toda excepción como fallo de red. Esto deteriora el diagnóstico y no demuestra que cada fallo sea de transporte. Los estados existentes no se modificaron.

En Cornare, `2a590db7-0330-4b8d-9403-5963e4bd15a1`, la admisión de actuaciones del día seguía `STARTED` desde 10:12:03 Bogotá; el intento automático posterior fue deduplicado y la cola registró un `WORKER_RESOURCE_LIMIT` previo. La observación certificada en Cloud era 02:48:55 Bogotá, 148/148 actuaciones, pero el MCP aún mostraba la observación de actuaciones del 20/11. No se deduce que falten filas ni que la observación nueva se haya incorporado.

En EDU, `e4e761ac-9984-462d-ae6e-a25b244f79ea`, Cloud certificó 76/76 actuaciones, seis páginas, observación 02:33:56 Bogotá; la aplicación seguía mostrando la consulta de actuaciones fallida del 14/11. En el horario de la cadena, `samai-read-api` registró dos lecturas almacenadas HTTP 200 con duraciones de 22,42 y 20,44 segundos, respectivamente. El último intento de la tabla de fuente terminó con `FunctionsHttpError` no específico. Las duraciones y la excepción **no prueban por sí solas** la causa exacta del fallo de la función administrada o un timeout; faltan sus logs y revisión efectiva.

## Ajuste preparado

`DailySourceIncomplete` distingue una respuesta lógica no completa de una excepción de transporte en `dailySourceAttempt.ts`. El programador envía el código estable recibido con la respuesta; si no es un identificador seguro, registra `SOURCE_READ_INCOMPLETE`. Se conservan el fallo, el mismo comportamiento de reintento existente y el cercado del intento. Un error de transporte genérico continúa como `NETWORK_ERROR`. No se convierte ningún resultado parcial en exitoso ni se altera el reloj de observación.

Esta corrección mejora el código de causa de **futuros** intentos. No repara por sí sola el bloqueo de Cornare, el fallo de procesamiento de EDU ni garantiza que las 23 entradas vencidas reciban otro intento. Un `cron.job_run_details` con éxito demuestra ejecución de SQL del programador, no admisión o finalización de cada fuente. Se necesita correlacionar el drenaje durable con esos pendientes, el `WORKER_RESOURCE_LIMIT` y los logs de las funciones publicadas.

## Validación y despliegue

- `deno test` con red a proveedores deshabilitada: 13 pruebas aprobadas (veredictos, fuente parcial, cuatro causas lógicas, transporte, cercado, reutilización idempotente y admisión de lectura almacenada).
- `deno check supabase/functions/scheduled-daily-sync/index.ts`: aprobado con configuración Deno temporal y dependencias en `/tmp`.
- La primera ejecución de typecheck con la configuración descubierta automáticamente falló por ausencia de `@types/node` en `node_modules`; se resolvió utilizando una configuración temporal, sin modificar el lockfile ni el repositorio ajeno.
- No se invocaron portales ni trabajos reales, no se gastaron créditos de IA y no se ejecutaron migraciones o escrituras de producción.

El cambio **no está desplegado**. Debe publicarse únicamente `scheduled-daily-sync` con el módulo compartido de la misma revisión, por el canal autorizado del backend administrado, después de comprobar la versión activa y preservar el trabajo concurrente. Un commit o un push no acreditan publicación. La prueba productiva debe comprobar que un resultado incompleto conserva su código sin adelantar el último éxito, que el reintento cercado continúa cuando corresponde y que una respuesta tardía no finaliza una concesión reemplazada. No realizar otra extracción para verificar una lectura almacenada.

## Seguimiento de las 16:50 Bogotá

Las mismas 23 filas seguían pendientes y vencidas. Trece tenían al menos una tarea `ACT_SCRAPE_RETRY` asociada; diez no la tenían. Esta comparación no prueba por sí sola que esas diez deban crear una tarea ni que su causa admita un reintento: incluye, entre otros resultados, restricciones y efectos pendientes de interpretación. Tampoco se modificó la cola.

La tarea de Cornare seguía con un intento contabilizado y siguiente ejecución prevista a las 10:27:11 Bogotá. La revisión de `net._http_response` acredita que la ejecución ordinaria del drenaje a las 11:30 procesó tres tareas distintas y no esa tarea. El SQL programado terminó sin error; eso no equivale a que Cornare haya sido elegido. La base reinició a las 10:58:22 Bogotá; ese hecho no acredita la causa de todos los pendientes. Los relojes y las inscripciones permanecen sin cambios.

Una única petición de salud interna, sin radicado ni consulta a proveedores, devolvió `sync-by-work-item` con marcador `samai-stored-batches-20261120-compact`. Ese marcador acredita la respuesta del endpoint de salud, no el contenido íntegro de la función desplegada. Las 15 páginas de la recuperación de Cornare del 20/11 son una ejecución anterior con su observación original, no una prueba de incorporación del 23/11. No se inició otra recuperación mientras falta acreditar el cierre de extremo a extremo de la vía por lotes para el día actual.

El ajuste preparado también distingue respuestas HTTP de errores sin respuesta. Para una `FunctionsHttpError` con `Response` real conserva un código estructurado válido, por ejemplo `WORKER_RESOURCE_LIMIT`, o usa `EDGE_HTTP_<status>`. Lee como máximo 4096 bytes y durante un segundo; no persiste el cuerpo. Una respuesta malformada o demasiado grande conserva el status, mientras que un verdadero error sin respuesta sigue siendo `NETWORK_ERROR`. Se mantienen el presupuesto y la condición de fallo. Esto no identifica retrospectivamente la causa del error inespecífico de EDU.

La batería final tuvo 16 pruebas Deno aprobadas, incluidas respuestas truncadas, cuerpo bloqueado, código de recursos, cercado y ausencia de éxito falso; el typecheck del programador pasó. Los intentos y la aplicación no se reescribieron y las pruebas no consultaron el portal judicial.
