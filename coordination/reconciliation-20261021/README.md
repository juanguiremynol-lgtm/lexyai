# Conciliación puntual del 21 de octubre

Inventario cerrado: los 72 IDs de `docs/evidence/controlled-act-insertions-20261021.json`.

| Expediente | IDs controlados | Legítimos conservados | Copias acreditadas archivadas |
|---|---:|---:|---:|
| 05001400301520240193000 | 42 | 4 | 38 |
| 05001400302320250063800 | 28 | 5 | 23 |
| 11001311001320240075200 | 2 | 2 | 0 |
| Total | 72 | 11 | 61 |

`inventory-72.json` enumera cada ID, identidad nativa, registro canónico y ruta de evidencia. Se contrastaron los snapshots oficiales CPNU ya obtenidos, la anotación y descripción completas, fecha, proceso, tenant y consolidaciones explícitas. No se equipararon filas por título/fecha ni por diferencias de totales. No quedaron identidades ambiguas. Las 61 copias no tenían documentos propios ni filas extras/provenance; sus referencias históricas permanecen válidas porque las filas se conservan.

Se archivó cada pareja en una transacción independiente. Se preservaron documentos, huellas, relaciones, historia, términos, alertas y notificaciones, incluidas las referencias que todavía apuntan al ID archivado. `consolidated_into` acredita el canónico y este recupera su identidad nativa estructural, sin cambiar su huella. No se retocaron las filas de términos o alertas asociadas; corregirlas sería otra tarea.

## Fechas Familia

Tres publicaciones decían `sin-fecha` en origen y tenían `published_at=0131-10-01`. Los tres pares acreditan mismo artículo nativo y PDF. Se descargaron, abrieron, extrajeron y renderizaron todas las páginas de los seis documentos de origen; el tercer par tiene nombres de objeto distintos pero contenido idéntico. Los canónicos anteriores ya tenían fecha nula.

Se dejaron las tres fechas en NULL y se archivaron únicamente esas tres copias demostradas. No se alteraron huellas para esquivar la unicidad ni se eliminaron registros. Se conservan las copias, sus rutas/colas y el dato original tanto en raw_data como en el respaldo privado. `familia-date-evidence.json` identifica los pares.

## Respaldo, garantías y reversión

La tabla privada con RLS `controlled_public_repair_20261021` conserva las imágenes completas previas y posteriores de cada pareja, su evidencia y los snapshots de referencias. No tiene permisos para anon/authenticated/service_role. No se exportan tokens opacos ni se versionan snapshots completos de datos de usuarios. Los 11 legítimos figuran como preparados y nunca se aplicaron.

`repair.sql` documenta las definiciones privilegiadas **ya instaladas**, no una migración pendiente ni parte del cron. La función solo acepta una pareja acreditada. Comprueba CAS completo y tenant; aborta si cualquier valor cambió. Para actuaciones, excluye únicamente el trigger de términos bajo bloqueo exclusivo transaccional y lo restablece antes del commit. Comprueba las demás consecuencias con snapshots protegidos. Para publicaciones no se toca fecha_fijacion ni se ejecutan triggers de inserción. No se desactivaron cron ni escritores globales.

Cada reversión se solicita individualmente con `repair_controlled_public_pair_20261021(id,true)` dentro de una transacción corta con lock_timeout. Rechaza sobrescribir datos posteriores por CAS. Esta entrega no ejecutó una reversión de los resultados finales. Probar la operación y su reversión sobre fixtures PostgreSQL y dos parejas reales dentro de transacciones terminadas en ROLLBACK acreditó su funcionamiento antes de aplicar.

`production-results.json` registra los 64 recibos de aplicación y la repetición real: 64 operaciones sin cambios adicionales, 11 legítimos idénticos a su imagen previa, trigger de términos habilitado y tres fechas nulas con original conservado. Los snapshots protegidos permanecieron iguales en las 64 transacciones.

No se ejecutó el paquete histórico SAMAI, las dos alertas antiguas ni cambios al término de 30 días. No hubo cambios de interfaz, MCP, publicación, Vault, dispatcher o cron.
