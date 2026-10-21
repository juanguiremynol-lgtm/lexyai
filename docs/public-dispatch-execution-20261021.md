# Ejecución pública del dispatcher — 21 octubre 2026

Este registro complementa, sin reemplazar, la entrega de Lovable en `public-closure-20261021.md`. Las observaciones siguientes son productivas salvo las pruebas expresamente locales. El día de las corridas es 20/10 en America/Bogota: las comprobaciones ocurrieron el 21/10 UTC, antes de la medianoche colombiana. No se fabricó una corrida con fecha futura.

## Configuración y activación efectivas

El canal SQL de **este** proyecto Supabase confirmó el rol PostgreSQL autorizado, acceso al esquema Vault y permiso de `vault.create_secret`. No se utilizó como prueba de autorización el acceso a Cloud SQL. Los valores técnicos coincidentes de los cron91/92 se trasladaron íntegramente dentro del servidor a Vault, sin exportarlos, imprimirlos, escribirlos en argumentos ni guardarlos en archivos. Solo se verificaron los nombres `CRON_SERVICE_KEY` y `SUPABASE_URL`. No se rotó una clave ni se rebajó autenticación.

La petición1016, con esa configuración, llegó a la validación real de `sync-publicaciones-by-work-item`: HTTP400 `MISSING_WORK_ITEM_ID`, sin401. Las ejecuciones posteriores prueban además procesamiento y persistencia; no se considera suficiente aquella validación inicial.

Aplicado `coordination/20261020011000_public_monitor_dispatch.sql`, después de0046 y las funciones compatibles de Lovable. **No se repitieron0046/0047/0048 ni `public_monitor_daily_seed`.** La activación incluye timeout HTTP explícito de140s, recibos privados de solicitudes y RLS en respaldos. La corrección estrecha `public-monitor-dispatch-current-first.sql` ya está aplicada: una corrida de hoy pendiente no espera detrás de varias históricas; la recuperación histórica restante conserva su protocolo y sus límites.

| Cron | Estado final | Horario | Zona |
| --- | --- | --- | --- |
|64 `andromeda-daily-estados` | activo, nueva llamada SQL autenticada | `20 12 * * *` (07:20 Bogotá) | GMT |
|97 `andromeda-public-estados-resume` | activo | `*/5 * * * *` | GMT |
|66 `daily-sync` | activo, horario y llamada conservados | `0 12 * * *` (07:00 Bogotá) | GMT |
|74 `process-estado-attachments` | activo, conservado | `*/6 * * * *` | GMT |
|91 `publicaciones-monitor` | desactivado, sustituido por64/97 | antiguo `0 11 * * *` | GMT |
|92 `samai-estados-monitor` | desactivado, sustituido por64/97 | antiguo `50 10 * * *` | GMT |
|GCP `pp-sync-cron` | ENABLED, conservado | `10 7 * * *` (02:10 Bogotá) | Etc/UTC |

El job temporal98 ejecutó una sola comprobación de arranque y después se eliminó. Su registro509087 sigue disponible. Los cron97 observados509103/509105/509110/509114/509118 ejecutaron la continuación real. No quedó ninguna barrera de escritura nueva ni se reactivaron escritores incompatibles. La reversión compatible preparada en `public-monitor-dispatch-stop.sql` solo detiene64/97 y conserva datos, protocolos y cron66; no fue necesaria.

## Corridas reales y repetición

La cola del día estaba terminada con el protocolo previo y todos sus intentos en0. Se guardó su imagen completa en el respaldo privado `2ac8b436-ab8d-4259-94ca-68e51a876240` y se realizó una única revalidación controlada del mismo día y UUID. Se incluyeron3 asuntos elegibles añadidos desde su snapshot anterior. El SQL rechaza repetir ese reinicio. No se alteraron fechas para simular una nueva corrida.

| Fuente | Corrida | Seleccionados | Completos | Parciales/fallidos finales | Pendientes sin procesar |
| --- | --- | ---: | ---: | ---: | ---: |
|Publicaciones Procesales | `987a1851-5055-4c5c-9493-37e40e41b06e` |47|46|1|0|
|SAMAI Estados | `ba5aab62-3e4d-4f06-82a8-562fb6efbbca` |15|15|0|0|

La fila parcial PP corresponde a `05001400302020250187800`, work_item `7a824800-7df0-4125-b883-43d04e9c92c2`: `PENDING_UPSTREAM` tras3 intentos. Una nueva consulta pública acotada acreditó `consulta_completa:false` / `LECTURA_PARCIAL`: el despacho fue leído, pero el descubrimiento por municipio `05001` dejó categorías sin cubrir (Acciones de Tutela, Comunicaciones jurídicas, Fijaciones, Notificaciones, Sentencias). Es cobertura incompleta del recolector, **no denegación documental ni consulta completa**. Se conserva el inventario obtenido y no se fuerza SUCCESS.

Las4 respuestas SAMAI vacías estaban mal clasificadas: `ok:true`, `SUCCESS_EMPTY`, HTTP200 en `samai_estados_summary`, pero `status:NO_DATA`. Lovable corrigió y desplegó el veredicto autoritativo, conservando los rechazos de pendiente/stale. Respaldo de sus3 intentos previos: `7fc01bb8-570f-4c56-a20c-7b8c55333987`. Se habilitó exactamente **una lectura adicional por asunto después del cambio**, mediante la misma cola y sus leases; el marcador impide volver a reiniciarla. No se modificó FAILED a SUCCESS mediante SQL. Las4 lecturas reales terminaron SUCCESS y la corrida OK.

Peticiones1018/1019 prueban arranque autenticado;1025 recuperó expresamente la corrida actual después de observar una histórica. Repetición1054/1055: HTTP200, sin timeout; PP conserva PARTIAL47/47 con1 fallo explícito, SAMAI OK15/15. Antes/después permanecieron idénticos los conjuntos de IDs de456 actuaciones (incluidos históricos),98 publicaciones y116 asociaciones de los6 casos de control. Esos conteos **no** representan documentos recuperados ni ausencia de duplicados históricos. Ver `evidence/public-dispatch-20261021.json`.

## Incidencias concretas

### J23 — `05001400302320250063800`

Antes: la aplicación llegaba al01/10. El último intento CPNU previo acreditado es19/10 09:00UTC,35 actuaciones, snapshot máximo01/10; las llamadas posteriores de publicaciones no sustituyen una consulta de actuaciones. No hay en la evidencia conservada una lectura CPNU del20/10 que permita atribuir con certeza la omisión a una causa histórica más específica.

Consulta pública actual: CPNU identifica `3991034091` / consecutivo126576580, AUTO TERMINA PROCESO19/10, anotación «Acepta Desistimiento Pretensiones»; y `3991034101` /126576581, Fijacion Estado20/10. La petición normal1023 los incorporó como:
- `bd83e79b-4a03-4964-8e87-4e8bcd88d836` (auto19/10).
- `b0601521-e42d-4a3c-b190-4ea8a2ebe94a` (anotación CPNU20/10).

No se importó el reporte externo como decisión judicial. El descubrimiento automático PP por radicado y despacho19–21/10 encontró artículo273810898, Estado12520/10 y `2025-00638AutoAceptaDesistimiento.pdf`. La sincronización normal1036 incorporó:
- Estado: `9bfda8e2-40b0-45eb-b872-cacb2cb28a38`.
- Providencia: `80098b0b-a566-46b7-9e37-ee7811a65d81`.

La lectura pública acotada de J23 también conservó `LECTURA_PARCIAL` por cobertura municipal incompleta;1036 persistió sus dos publicaciones sin marcar esa consulta como completa. No se confunde ese intento posterior con los conteos del snapshot diario previo.

El enlace de procedencia del Estado125 inicialmente apuntaba al auto individual; Lovable corrigió el mapper por rol y rectificó ese enlace de manera acotada. La relectura SQL distingue la URL oficial del estado (uuid2003ad39-9316-5546-8fd9-82cf06f4c3ef) de la providencia (uuid12a95c98-7757-f612-3c47-d4ffdba0402f), manteniendo ambas copias. La repetición normal1085, después del despliegue, devolvió HTTP200,0 inserciones y22 reconocidas, conservando las dos URLs por rol y el resultado parcial de consulta. Los conjuntos de IDs de actuaciones, publicaciones y asociaciones permanecieron iguales; el contador42 de encolado no son42 asociaciones nuevas.

Dos PDFs originales: estado11 páginas,1.789.710bytes, SHA de trazabilidad `a69b32e5ea8a69259be660e74d06cd4a7afe371d1c8829c5c3d5e24bc45f1fea`; providencia3 páginas,163.027bytes, `e60ffbacefba704375a01ceb572359124353cb2c78ba2724332d008a981ba282`. El texto de la providencia leído confirma que acepta el desistimiento y dispone el archivo. No se calculan recursos ni términos en esta comprobación.

La cola normal descargó y leyó ambos PDFs y conserva4 asociaciones en las2 publicaciones relacionadas. Sus documentos principales son distintos y correctos; `pdf_available:true`, rutas propias y `validation_evidence.state:verified`. La lectura productiva usa PDF.js, texto y operadores de todas las páginas, con correspondencia por artículo/radicado/ruta nativa y relectura de almacenamiento; no valida firma digital. Una comprobación local adicional sobre los bytes reales renderizó las11+3 páginas con PyMuPDF. Ni hash ni cabecera PDF se usan solos como prueba de integridad.

### Familia — `11001311001320240075200`

La actuación14/10 ya existía (`787462be-ac55-4b9a-ac56-8ae81829f98a`), consecutivo27 / idReg3988097391: se preservó. Las dos ausencias se identificaron por origen:
- idReg1679076541 / cons8,24/02/2025, Fijación y desfijación de estado: no había copia activa; la lectura normal creó `21eb972f-8fa1-4ac2-a7d6-f1f23221ea84`. El registro archivado previo no fue modificado.
- idReg2811261251 / cons68818314,04/02/2026, Auto Emplaza, proceso de origen3241026841: el backend conservaba28 actuaciones en la unión, pero `filtrarProcesos` devolvía solo las27 del principal en el campo canónico. Se corrigió la lista canónica conservando origen y documentos, y `actuacionesPrincipal` mantiene la vista principal explícita. Resultado productivo:28/28, nueva `eabb2d7b-5736-49c3-a8fd-9839baf5a740`, `_idProceso:3241026841` persistido.

El documento3953560961, `02AUTOEMPLAZA.pdf`, ya tenía copia CPNU y ahora quedó asociado al registro correcto. Se obtuvieron realmente339.344bytes, SHA `2227aded02ef14caa24c984f186efb1e3278b8a2fa19bf0f9e21f18d92b5ffe1`; se leyeron y renderizaron sus2 páginas. Su fecha de providencia22/01 no se sustituye por la fecha de la anotación04/02. Esta lectura de control no transforma automáticamente la metadata antigua del inventario en lectura productiva registrada.

### J15 — `05001400301520240193000`

La cronología oficial también termina14/09. No se confirmaron «tres omisiones» restando53 menos50. La comparación de registros demostró cuatro anotaciones distintas absorbidas por consolidaciones anteriores bajo otro texto:

| Origen CPNU | Fecha | Anotación propia | Registro activo incorporado por el circuito normal |
| --- | --- | --- | --- |
|106713631 / idReg3766536251|23/02/2026|SOLICITUD ADICION Y CORRECCIÓN|`689f7020-8d3e-4538-9a27-3d58c397d90d`|
|106713629 /3766536231|17/02/2026|NOTIFICACIÓN|`09b1df29-fabb-4705-8be5-1a70fb0e45af`|
|106713617 /3766536111|22/09/2025|Ratifica contestación de la demanda|`379a0254-60e6-4dfa-b142-a47ab1e8c1dd`|
|106713489 /3766534831|20/06/2025|PODER|`d6945aed-5ede-4a57-b44c-afc494938d36`|

Se preservan las otras anotaciones independientes: PRONUNCIAMIENTO SOBRE REQUERIMIENTO, SOLICITUD AMPARO DE POBREZA, Ratificación del juramento estimatorio y NOTIFICACIÓN, respectivamente. No se fusionan por fecha/título. La corrección de Lovable solo usa identidad CPNU conservada con contenido correspondiente; no heurística de conteos. Otras2 identidades siguen en hermanos archivados con punteros de consolidación y no justifican crear un tercer registro. No se alteran esos históricos. Para los cuatro registros propios, CPNU respondió `conDocumentos:false` y0 documentos; no se atribuyeron otros PDFs del expediente para completarlos.

### Yolanda y Rionegro

Yolanda, orígenes126602271/126602272, conserva rechazo19/10 `c336c833-867b-459e-af8e-c58c2ce39c36` y fijación20/10 `41863b8c-76c4-419e-83fb-94c3fb16ae1c`.

Rionegro, orígenes126585184/126585186, conserva admisión19/10 `e88ca51e-fdb8-434e-a282-00d8bb755576` y fijación20/10 `60565506-6169-4cd3-8b45-1ec698798945`.

Peticiones1044/1045: HTTP200,0 insertadas,8 reconocidas por caso, fecha máxima20/10. No se reinsertaron los registros señalados.

### El Retiro — `05607408900120260045600`

Se comprobó la publicación `64b6f5b4-65d8-4364-a561-438167ff296e`: tipo Estado Electrónico, Estado05708/10, artículo270169827, copia almacenada y lectura registrada de4 páginas; atribución del proceso a la página2 verificada. La tabla de actuaciones conserva0 filas. Es una publicación, no una providencia individual ni prueba de que CPNU exponga actuaciones de ese expediente. No se promovió la planilla para aumentar un contador ni se declaró privado el proceso por404.

## Regresiones detectadas y resueltas durante la ejecución

La primera incorporación normal de J15/J23 mostró un fallo de reconciliación legado: el índice posicional de filas consolidadas se confundía con el nativo, creando copias `_o`. Después, elegir la fila antigua para enriquecerla chocó con la unicidad que ya poseía la copia nueva:1041/1042 HTTP500 `PERSISTENCE_UNKNOWN`. Se mantuvo el error, sin simular SUCCESS. Lovable desplegó preferencia por la única fila que ya posee explícitamente el origen nativo y conservación incremental de `_idProceso`. Relecturas1075/1076/1077: HTTP200,0 insertadas,53/37/28 reconocidas. Las cuatro actuaciones legítimas J15 siguen separadas.

**No se archivó ninguna fila en esta intervención.** Las72 inserciones iniciales de las consultas controladas incluyen actuaciones legítimas y copias derivadas del fallo legado; no se presentan como72 novedades reales. El inventario exacto de IDs quedó en `evidence/controlled-act-insertions-20261021.json`. La conciliación de copias existentes permanece separada y no se ejecutó como limpieza automática. Originales, huellas, referencias y documentos se conservaron.

Una dependencia real del cron66 se reprodujo con DIRECT_ITEM Yolanda1048: HTTP500. Lovable acreditó en registros el401 de su llamada interna a `sync-by-work-item` sin `x-cron-key`, y desplegó la cabecera con la clave técnica existente. Repetición1078: HTTP200 DIRECT_ITEM, consulta no aplazada. No se rebajó autenticación, no se modificó el cron66 ni se ejecutó un barrido general. Los fallos rápidos históricos del20/10 son compatibles con esa causa, pero no se atribuyen uno por uno sin registros disponibles.

## Fechas, pruebas y límites

Los tres valores0131 de Familia nacían en el mapper de aplicación, al extraer8 dígitos dentro del radicado cuando el backend decía `sin-fecha`. Lovable corrigió la lectura estricta y calendarios, desplegó sus funciones actuales y guardó respaldo0049. `fecha_fijacion` quedó NULL; `published_at` todavía requiere conciliación por una colisión con filas históricas equivalentes. No se deduplicaron ni archivaron para eludirla. Esa limitación se conserva expresamente.

Pruebas nuevas locales:3 Node del contrato CPNU y PostgreSQL desechable del SQL final (Vault/net/cron simulados, timeout140s, sustitución64/91/92, prioridad hoy, reanudación e incorporación posterior al snapshot, RLS, repetición de reinicio rechazada). Las pruebas previas de503 asuntos, fencing de respuestas tardías y límite3 se reutilizaron; no se simularon como producción. Lovable aportó pruebas y despliegues de identidad, veredictos y fechas; las respuestas productivas citadas comprueban su comportamiento real.

Backend CPNU nuevo: commit `fdb68575aeb12d6c6d8d68a7fa0a1d7bc155f2a0`, build `04ccf096-1092-4308-bd08-b496f2681fa5`, imagen `sha256:123f9ff5d6fa391d58895b8eb3de6d22911118e416db83c2d11f86b65616d7c0`, revisión `cpnu-https-jobs-00034-h98`100%. Se comparó el código de la imagen anterior con HEAD antes del ajuste. Su imagen anterior `sha256:e23314dbb3f5c2eade2bfb66eaca9bdcbb078f81539fd48d2c13497faf0a2c6a` quedó identificada para revertir solo ese servicio. Los servicios PP desplegados previamente no se volvieron a desplegar.

Vault y el dispatcher funcionan y el backend está integrado con los monitores. No se declara cerrado todo el producto: queda la cobertura parcial PP señalada, las conciliaciones legadas descritas y la publicación/prueba final de interfaz asignada a Lovable. No se usó autenticación personal SAMAI; no se ejecutaron reparación histórica SAMAI, dos alertas antiguas ni cambios al término30 días. Tampoco se presentan como recuperados los seis memoriales ni se altera el original1074556.
