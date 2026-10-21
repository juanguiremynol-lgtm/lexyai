# Omisiones concretas del informe de 62 procesos

Trabajo sobre main 1c0f10cd del backend, preservando las fuentes PP ya desplegadas (521c15c / revisión 00069-rap) y pp-read-api 7de6dd9 (00014-4pl). Esos cambios previos no están en main; el diff grande contra main no representa cambios nuevos de esta intervención. No se despliega la aplicación ni se modifican sus archivos de ingesta, presentación o seguridad.

Correcciones nuevas: referencias narrativas a «Juzgado» o «radicadas» no truncan una providencia; un nombre corto de PDF solo descubre candidatos, el contenido descargado debe acreditar el proceso y su instancia; una asociación histórica demostrada como no acreditada se conserva con observación y respaldo, pero deja de emitirse como actuación atribuida. Ambos feeds PP exponen `asociaciones_no_acreditadas` de manera aditiva. No se borran filas, archivos, novedades ni reconocimientos.

Pruebas locales: 7 casos nuevos de continuación, límites, instancia opuesta, planilla y fallo de lectura, más los 17 de cobertura municipal preservados. Comprobación aislada con los PDF públicos originales: estado 031 Amagá, auto completo páginas 11–12 del paquete de 22; providencia asociada al estado 137 J21, páginas 1–5. Originales intactos; hashes de descarga como trazabilidad, lectura/renderización de todas las páginas y correspondencia de identidad comprobadas por separado.

Publicaciones sin atribución al proceso no equivalen a novedades omitidas: los PDF 033 y 034 de Amagá consultados corresponden a otros procesos. El directorio de adjuntos incluye archivos de todo el año; su mera presencia no demuestra relación de cada archivo con cada publicación.

La planilla del estado 137 contiene 05001310302120260021100, mientras la providencia individual del mismo artículo identifica explícitamente 050013103021-2025-00211-00. Se conserva la discrepancia del origen: no se corrige el año de la planilla ni se atribuye esa fila al proceso 2025 o a su instancia 01. La relación con 2025/00 se acredita mediante la providencia individual.

No se ejecuta reparación histórica SAMAI, cambios de términos/alertas, conciliación de los 72 IDs, ni cambios de Vault o nuevos cron. Las observaciones, ejecuciones y resultados productivos se documentan al terminar; las pruebas locales no se presentan como despliegue.

## Contrato y resultados observados el 21 de octubre (UTC)

### SAMAI 05001233300020240115300

Consulta pública y `/snapshot` contienen el traslado índice 134 (`samai_actuaciones:34000`): En persistencia, `fecha_actuacion` es 2026-10-20; en la API, `fecha_providencia_iso` y `Fecha Providencia` conservan ese 20/10, pero `fecha_registro` es 2026-10-19. El feed no exige que exista una clave `fecha_actuacion`. La actuación de aplicación `20a99e34-68e6-4085-86cf-fe9e95eda2f9` usa 19: entregar a Lovable la elección del campo, conservando ambas fechas originales. No se modifica el recolector ni términos.

Índice 137, solicitud 3443978, origen `samai_actuaciones:34004`, ya está en la aplicación como `7777740f-6063-4c90-9aa7-0035240e26f7`, fecha 20. Índice 138, correo, origen `samai_actuaciones:34003`, ya está como `fb3fe267-ffd8-4cd3-acb1-cf94efbeaf4f`, fecha 20. Sus tres PDF almacenados (3, 3 y 1 páginas) fueron descargados y renderizados; no son recuperaciones nuevas de esta ejecución. El PDF escaneado de tres páginas no aporta identidad extraíble por texto: conservar la relación de inventario, sin fingir comprobación semántica por texto. Feed: 138 actuaciones y 23 estados separados.

### SAMAI 05001233300020260142400

El ciclo programado del 21 a las 07:45:19 persistió los índices 27 y 28 (filas 34006 y 34005), ambos 20/10. El 20/10 a las 07:49 todavía no estaban. Índice 27: solicitud 3445893, cinco anexos anunciados; índice 28: correo, descripción «2Archivos» y contador de cuatro anexos en la grilla. Ninguna cifra acredita archivos recuperados.

La consulta ACTUACIONES de aplicación observada a las 05:00 del 21 precedía esa actualización y vio 26. La consulta posterior de ESTADOS no incorpora estas actuaciones. `/snapshot` devuelve 28 actuaciones y tres estados. Entregar a Lovable ambos orígenes y la incorporación ACTUACIONES: no crear estados duplicados. Ejecución normal controlada `samai-sync-job-hq8qq` 15:48:31–15:53:35: cero novedades adicionales, mismas 28 actuaciones, detalle sin inventario documental observado 15:51:36/38. Los anexos siguen no recuperados por la vía pública consultada; no se clasifican como inexistentes ni privados.

### CPNU 05001400300220250105400

Fuente pública mediante el recolector autorizado y `/snapshot`: 15 registros. `/work-items/5899208b-cdfd-4b83-b415-0b7c7a2769d9/actuaciones` también contiene dos actuaciones distintas de 16/10 «Agregar Memorial / Correo electrónico»: consActuacion 126614731, idRegActuacion 3991487491 (fila 22392), y consActuacion 126614718, idRegActuacion 3991487361 (fila 22393). La aplicación observada llegaba al consActuacion 126467254 del 15/10. No colapsar los dos orígenes por compartir título/fecha. Ambas constan ya en la corrida del 20/10 (6152); no hay omisión del recolector. `con_documentos=false`: no se anuncian enlaces documentales públicos para estos eventos. Consulta pública controlada job_1792596997140_85952fec1dbd, DONE, 15 registros. No se reinsertan actuaciones.

### PP Amagá 05030318900120250000200

Estado 031: artículo nativo 262954054, publicación 18/09; providencia auto 151 de 17/09 en páginas 11–12 del original de 22 páginas. Fila persistida 1007, work item PP 29. Corregida copia truncada de una página: la copia productiva de dos páginas se descargó, leyó y renderizó, con identidad del proceso comprobada; SHA-256 de trazabilidad eef1748975b40c240f4e917c5213c9a3956449e939af3a57b40bac39360e3d06. Original conservado. La planilla imprime un número distinto del artículo/archivo: conservar esa discrepancia.

Artículos 033 (270726925, 09/10) y 034 (271318103, 13/10): los PDF seleccionados por su número, de nueve y trece páginas, no acreditan este proceso. Los tres artículos exponen el mismo directorio anual de 26 archivos; la mera presencia de archivos en ese directorio no acredita asociación. No se crean novedades para alcanzar un conteo de nueve.

### PP J21 05001310302120250021100 / instancia 01

Artículo 272173949, Estado 137 publicado 15/10, providencia 14/10. La providencia original identifica explícitamente 050013103021-2025-00211-00; cinco páginas completas recuperadas en la copia, SHA de trazabilidad 483a8bf1020cfe813139b8568b5e3796dab99990352d14cff1c43f669394cdcf. Fila canónica 1093, work item PP 31. La fila de planilla tiene año 2026: no acredita una fila del proceso 2025. Se conserva como contexto de publicación separado de la providencia, con `observacion_planilla`, `fila_atribuida=false` y original propio. `paquete.url_original` identifica de qué original proceden las páginas del caso.

La asociación anterior de la misma providencia a la instancia 01, fila 1097/work item 120, está demostrada incorrecta por contenido y SHA original 1725f9619a1221e0de5e1e4ab6f94cbc34c8eb17152806a4f2986030a92a31eb. Rectificación acotada ejecutada con imagen previa/compare-and-swap, ensayo ROLLBACK y repetición sin cambios; únicamente añade `asociacion_no_acreditada` y evidencia a `documento_atribucion`. Cero triggers en la tabla. No borra/archiva filas ni altera novedades, documentos o reconocimientos. Copia privada anterior/posterior y restauración condicionada conservadas. Ambos feeds excluyen esa asociación de las actuaciones atribuidas y exponen `asociaciones_no_acreditadas` (id, artículo y causa); el lector también evita emitir su novedad como nueva, conservando el reconocimiento subyacente.

Lovable debe tratar las publicaciones de aplicación de instancia 01 `762d1400-dd18-4e98-b27f-d5cdefc09046` y `9644ffc8-c767-45ea-9bc4-f079afaab68c` conforme a esta evidencia, preservando archivos e historia. Las correctas de instancia 00 son `4a322889-ee1b-44de-bfbe-cc0c63424b95` y `70f2ff14-734c-44a6-9dbf-dd821379640c`. No se escribió en la aplicación durante esta intervención.

## Programación y controles adicionales

Crons GCP existentes habilitados, UTC: cpnu-sync-cron 07:00; pp-sync-cron 07:10; samai-sync-cron 07:20; samai-estados-sync-cron 07:30. Todos los procesos investigados están activos. No se cambia Vault ni programación. La incorporación automática de novedades posteriores se observó realmente en SAMAI: corrida del 20 sin los índices 27/28, corrida del 21 con dos altas, repetición del 21 con cero. CPNU registra los dos orígenes del 16 en su corrida del 20. La comprobación de la ingesta posterior en la aplicación corresponde a Lovable; un cron SQL ejecutado no demuestra por sí solo que su petición HTTP completara la ingesta.

Familia y J15: las consultas públicas actuales y los snapshots principales devuelven 28 y 53 respectivamente. La aplicación ya registró esas cantidades en sus intentos de proveedor de las 01:49. No se reinsertan actuaciones por tarjetas antiguas. El endpoint secundario cpnu-read-api devuelve conjuntos persistidos históricos distintos (25/91); no usar ese conteo como autoridad del snapshot ni deducir identidades faltantes o duplicadas sin conciliación, fuera de este alcance.

Fecha futura SAMAI 05001333300320190025200: origen `samai_actuaciones:33`, índice 40, fecha 10/11/2026 y registro 14/05/2026 10:44:31 intactos. La consulta completa del 21 contiene las 40 actuaciones y siete estados. El recolector recorre índices y usa antigüedad de observación de caché, no la fecha máxima del evento como cursor excluyente. No se convierte en evento programado ni se reemplaza por hoy.

## Repetición y límites

29 pruebas focalizadas locales aprobadas (12 incidencias/17 cobertura), más lectura de PDF reales aislada. En producción, corridas PP 13014/13017 Amagá y 13015/13018 J21: cero actuaciones nuevas; IDs canónicos conservados. La petición cliente de repetición J21 agotó 360 s, pero la corrida 13018 terminó en el backend a las 16:19:25: no se presenta esa petición como respuesta HTTP satisfactoria. J21 mantiene LECTURA_PARCIAL por cobertura incompleta de otras categorías: una providencia completa no convierte toda la consulta en completa. Pendientes de aplicación no equivalen a fallo de descarga del backend. No se declara conciliado el conjunto de 62 procesos ni probado WorkItemDetail.

## Despliegue y verificación final

Código preventivo PP `f4ffc4b` (incluye `44ff548`, `9be4319`, `a31db57`), imagen `sha256:041da1f86d17df32bc9d5dcad033e59bac33005d930af337814ad3c74c619b45`, Cloud Build `1183b924-d117-4b65-ab19-27bb506ed351`, revisión **publicaciones-procesales-api-00075-sab**, 100 % de tráfico después de prueba de candidata lista. Reversión compatible disponible a 00073-bir (conserva el filtro de asociaciones no acreditadas). Lector **pp-read-api-00016-haq**, código `9be4319`, imagen `sha256:5ddc7b3e656c97f2f42c75a836d89619d3f728f2445adca00376b7c12bbe913a`.

Verificación real de candidata 16:30:28–16:31:19 y repetición productiva 16:32:01–16:32:48 UTC: HTTP 200, LECTURA_PARCIAL explícita, 26 registros de los tres work items de control sin cambios de identidad/asociación/copias previas, cero altas. Corridas 13019 y 13020, ambas cero actuaciones nuevas. Planilla original recién preservada: tres páginas, SHA 8abdd4bf0ed42e4c60f60bb3520d497bee2d980476eb9594c030da7c7160569c. Providencia original: cinco páginas, SHA 1725f9619a1221e0de5e1e4ab6f94cbc34c8eb17152806a4f2986030a92a31eb. Copia derivada: cinco páginas, SHA 483a8bf1020cfe813139b8568b5e3796dab99990352d14cff1c43f669394cdcf. Todos descargados de almacenamiento y renderizados; igualdad de URLs y SHA entre ambas ejecuciones. La planilla no genera una copia de fila ni una segunda providencia.

Sin nuevo despliegue SAMAI/CPNU: samai-https-jobs-00021-pup, samai-read-api-00017-det; cpnu-https-jobs-00034-h98, cpnu-read-api-00023-rj8. Se conserva main de Lovable 0e6219ac para la entrega documental; no se despliega código de aplicación. Pendientes concretos: ingesta ACTUACIONES posterior a los nuevos índices SAMAI y memoriales CPNU; fecha principal del traslado 134; tratamiento en la aplicación de la asociación PP no acreditada y su observación de planilla. Las consultas PP parciales conservan sus causas, sin cambiar ERROR/PARCIAL a SUCCESS por un conteo.

Confirmación final del endpoint consumido por el adaptador SAMAI: `/buscar?numero_radicacion=…`, HTTP 200 a las 16:36:50/54 UTC, contiene los cinco orígenes indicados. Sus categorías son ACTUACION, separadas de los estados; totales combinados 161 y 31 no son conteos de actuaciones. La respuesta grande se obtuvo completa con transporte sin compresión; una sonda anterior del cliente local quedó esperando cuerpo pese a respuesta 200 en el registro del servidor y fue detenida, sin ejecución ni escritura adicional. No se atribuye ese incidente de transporte local al monitor productivo.
