> Continuación posterior: [aceptación del 1/11](daily-sync-acceptance-20261101.md). El despliegue pendiente por UUID y la corrección de CPU ya se publicaron; este documento conserva su corte histórico.

# Coordinación del consumidor diario — 1 de noviembre de 2026

Corte de resultados: **31 de octubre de 2026, 21:42:19 America/Bogota**.
Este registro continúa la intervención existente. No certifica el 99 %, la
publicación de interfaz ni la recuperación de los seis memoriales SAMAI.

## Versiones conservadas y realmente publicadas

El backend es **Lovable Cloud**, proyecto
`fd922a87-5316-40ea-97b8-727cf903a9b8`, runtime `qvuukbqcvlnvmcvcruji`.
No se solicitó otro inicio de sesión personal de Supabase ni se reemplazó el
backend. La rama integrada conserva main de Lovable
`99138fe727bfec778d7d65d34efe028a89761b74`, sus tipos generados y migraciones.

| Publicación por el canal admitido | Fuente incorporada | Componentes |
|---|---|---|
| `umsg_01m6a6zwkned087vnbx5c1h7hh` | `cb5275382dff98de8e73f151e095165491a877e9` | sync-by-work-item, sync-publicaciones-by-work-item, ambos monitores de estados y demo-radicado-lookup |
| `umsg_01m6a8cz0afhq9883gm2c1dmb5` | `56b7c7a94a0f67f910798dbe91a3cfde38c31417` | sync-by-work-item y sync-publicaciones-by-work-item |
| `umsg_01m6a9qt8qfzg8pqx4j2qsmvtw` | `cafaa63968e351a7ac79abdc85a0fb4a0d39df40` | sync-by-work-item |
| `umsg_01m6aawxz9fdbr1qwye626g9n7` | `99138fe727bfec778d7d65d34efe028a89761b74` | **Solo SQL 0099**; no publicó la función pendiente |

La versión del supervisor sigue siendo `27b339f734c8379a9baadeb7e9a3f31bd05ed8df`.
Un commit integrado, una huella local o una compilación no prueban por sí solos
la versión de una Edge Function. Las publicaciones anteriores y sus respuestas
productivas son la evidencia disponible; no se obtuvo una inspección binaria
independiente del bundle remoto.

## Correcciones activas

- Las consultas CPNU deshabilitadas con `allow_buscar=false` no se reactivan por
  rutas alternativas. Se preservan resultados positivos de una paginación
  parcial, sin afirmar consulta completa. Respuestas negativas explícitas,
  indisponibilidad, HTTP 200 sin contrato y caché ausente son resultados distintos.
- Una consulta vacía válida conserva el enum permitido `SUCCESS`; no inserta una
  actuación ficticia ni intenta persistir el valor inválido `EMPTY`.
- La observación original de la fuente se conserva al incorporar un feed.
  Una reingesta de caché no actualiza el último éxito del proveedor.
- SAMAI Estados registra UTC explícito. La reutilización de una lectura diaria
  exige expediente, traza, fecha Bogotá, historia exitosa y filas contabilizadas;
  `DONE` por sí solo no basta y reutilizar no renueva la observación.
- El consumidor puede leer la ventana pública RECIENTE ya completa por su UUID
  exacto aunque un backfill histórico continúe pendiente. La cobertura del plan
  completo sigue siendo independiente.
- Las audiencias ya acreditadas en la misma actuación, día y hora inequívoca no
  vuelven a generar efectos. No se modifica una audiencia ambigua por inferencia.

## SQL aplicado, con imagen previa y alcance exacto

Se ejecutaron los siguientes archivos de `coordination/`; son recuperación de
colas o contratos, no reparación de decisiones judiciales:

1. `20261101_recover_samai_monitor_read_contract.sql`: doce esperas exactas del
   monitor; intentos conservados.
2. `20261101_cpnu_remaining_enum_recovery.sql`: nueve errores del contrato vacío;
   solo lectura de caché, sin tráfico de consulta CPNU.
3. `20261101_cpnu_negative_contract_recovery.sql`: seis negativos técnicos
   acreditados; quedan no completos, sin archivar ni modificar identidad.
4. `20261101_pp_certified_reader_recovery.sql`: Amagá y Sopetrán enlazados a sus
   recibos RECIENTE completos; la historia y el plan completo no se reclasifican.
5. `20261101_recheck_existing_hearing_evidence.sql`: una comprobación de dos
   parciales; no cambió el estado de las audiencias. EDU conserva
   `PERSISTENCE_FAILED` en ese primer intento; el otro caso conserva el efecto
   pendiente ambiguo. El seguimiento selectivo posterior se detalla abajo.
6. `drizzle/migrations/0099_publication_persistence_receipt_id.sql`: el RPC retorna
   `persisted_publicacion_id` solo cuando hay un registro único confirmado.
7. `20261101_amaga_attachment_delivery_recovery.sql`: ocho asociaciones ausentes
   por artículo y asset nativos exactos; dos asociaciones existentes preservadas.
8. `20261101_amaga_derived_binding_followup.sql`: una relectura del mismo recibo
   para incorporar procedencia, páginas y huella de la copia derivada.
9. `20261101_publication_ingestion_permissions.sql`: el RPC interno de escritura
   deja de ser ejecutable por PUBLIC/anon/authenticated; service_role conserva
   ejecución. El único caller del repositorio es de servidor con service_role.
   RLS y permisos de lectura no se relajaron. No es una migración Drizzle 0100.
10. `20261101_edu_schema_cache_followup.sql`: una sola relectura cache-only del
    error transitorio exacto de EDU, con antes-imagen y recibo 240 acreditados.
    Petición 287: HTTP 200, 76 existentes, cero inserciones, source clock original
    y DONE persistido. Las tres audiencias y su hash permanecen iguales. Repetir
    el ajuste afecta cero filas y no genera otra petición.

Las repeticiones de las reparaciones selectivas no agregaron filas a sus planes.
Se conservan auditorías privadas, intentos anteriores, huellas y documentos. No
se ejecutó el antiguo paquete histórico SAMAI, las dos alertas ni el término de
30 días. No se archivaron ni eliminaron asuntos o actuaciones.

## Única publicación de función todavía bloqueada

Falta publicar **sync-publicaciones-by-work-item**, desde esta rama integrada.
La diferencia respecto de la fuente publicada `56b7c7a9` usa el
`persisted_publicacion_id` retornado por el RPC y lo relee con filtros de
`organization_id` y `work_item_id`, antes del fallback por huella. No reescribe
huellas ni deduce identidad con fecha/título. El cambio se preparó en
`ba8d8488`; sus dependencias ya están integradas.

**0099 ya está aplicada; no debe repetirse.** El canal admitido rechazó el
mensaje de despliegue porque el espacio de Lovable agotó créditos. La acción
mínima es reponer créditos de ese mismo espacio y publicar esta única función.
Publicar frontend o enviar GitHub no equivale a publicar Edge Functions. No se
intentó sustituir la administración de Lovable con credenciales personales.

Secuencia al habilitarse el canal:

1. Obtener el main entonces vigente y conservar cualquier cambio posterior de
   Lovable; comparar solo el cambio de lectura por ID confirmado.
2. Comprobar que el RPC productivo contiene el recibo único y sus permisos de
   servidor; **no** ejecutar todas las migraciones del repositorio.
3. Publicar únicamente sync-publicaciones-by-work-item por Lovable Cloud.
4. Releer el recibo existente de Amagá
   `1eddbd28-202a-4f94-b7be-260705f7858a` por el flujo normal autorizado:
   cero publicaciones nuevas, cero fallos de lookup de adjuntos, asociaciones
   previas conservadas y sin consulta nueva al portal.
5. Registrar mensaje de publicación, commit remoto y respuesta persistida.

La repetición productiva actual (petición 256) obtuvo SUCCESS de consulta,
20 unidades ya existentes, cero inserciones, pero conserva cinco avisos de lookup
del consumidor antiguo. Las ocho asociaciones concretas de Amagá ya se
recuperaron mediante el plan nativo auditado; esto no sustituye la corrección
preventiva pendiente.

## Evidencia real y límites

- Cron 97 creó/reanudó el run SAMAI Estados
  `68f2c917-02ca-4bcd-931c-b912f88f4891`. Terminó 31/10 a las 19:26:47 Bogotá:
  15 asuntos acumulados completos, doce consultas públicas nuevas y tres
  lecturas válidas anteriores conservadas.
- Se incorporaron tres providencias históricas con sus copias de dos páginas:
  `0e29f279-f52f-4698-923e-d03dd681ae5c`,
  `f942d522-33c7-42b7-8f88-c943bf64c2e1` y
  `919593af-3e42-4aba-8f2a-19cdb40aef2f`. No son tres novedades judiciales de hoy.
- La petición 222 reutilizó una lectura completa: `provider_called=false`, cero
  inserciones y observación original conservada. No se volvió a consultar SAMAI.
- Ocho asociaciones documentales de Amagá están descargadas y leídas: cuatro
  paquetes originales y cuatro extractos derivados, no ocho providencias
  íntegras. Se conservaron originales y asociaciones anteriores.
- Un caller autorizado con RLS pudo obtener y leer la descarga firmada de la
  publicación `0e29f279…` (dos páginas, SHA coincidente con el archivo obtenido).
  La publicación `8c1f130c…` sigue entregando su copia antigua de tres páginas,
  distinta del nuevo extracto de una página. No se sustituyó ni recertificó
  silenciosamente esa copia anterior.
- No hay sesión web autenticada disponible: botones, renderizado y publicación
  visual siguen sin comprobarse. Una lectura por MCP/RLS no es una prueba UI.

Las pruebas focalizadas Deno y los checks de tipos de ambas funciones pasaron.
Las pruebas SQL usan PostgreSQL aislado en el puerto 55439, con datos fixture;
incluyen recuperación repetida, conservación de intentos, identidad nativa,
recibo único/batch ambiguo y permisos. No son ejecuciones productivas.

El desglose por los 138 pares asunto–fuente, sus relojes y pendientes está en
el repositorio backend, `docs/evidence/daily-sync-20261101/`. PP pasa de 1 a 8
incorporaciones completas en aplicación; su número de ventanas completas en
fuente sigue siendo 8/54. SAMAI Estados pasa de 3 a 15 incorporaciones completas.
SAMAI actuaciones pasa de 14 completas y una parcial a 15 completas.
La meta 99 % y la continuidad diaria global **no están acreditadas**.
