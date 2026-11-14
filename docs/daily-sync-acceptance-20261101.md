# Coordinación de aceptación: 1/11/2026

Main de Lovable preservado hasta `c616c431bfacc98051a3ff891d0b24a626375392`.
Los cambios posteriores de silence-notice-sweep y tipos se conservan por merge;
no se editaron ni desplegaron desde esta intervención. Las funciones reparadas
siguen vinculadas a las revisiones específicas indicadas abajo.
No se desplegó este checkout ni se publicaron componentes de interfaz desde aquí.
La integración conserva los cambios, tipos y contratos de Lovable.

## Funciones efectivamente desplegadas por el canal soportado

- `sync-publicaciones-by-work-item`: main `fab7a33e…`; mensaje
  `umsg_01m6bg0a0xe3ztmee7g7zdfkba`. Se desplegó la lectura por UUID confirmado;
  no se reaplicó SQL 0099 ni se cambiaron configuración o secretos.
- `sync-by-work-item`: implementación `e048554c21f324587d9f9312d519424365b474db`,
  main `100615a2…`; mensaje `umsg_01m6bphqgjek29wnn20ezar2fw`.
  Corrige el CPU excedido al recanonicalizar repetidamente variantes documentales.
  58 pruebas y `deno check` ejecutados por Lovable; no se repitió la batería.

Aceptación productiva del consumidor UUID: peticiones 593/594, con época de
transporte anterior al reinicio de la base a las 13:37:57 UTC. Nicholls conserva
3 publicaciones y La Ceja `05376311200120230031400`, 23; IDs, fingerprints y
asociaciones permanecen, con cero cruces de asunto/organización. Cero inserciones
y cero fallos al encolar asociaciones. Los contadores de encolado no representan
archivos nuevos. Los dos lectores MCP bajo RLS devolvieron los procesos correctos.

Después del reinicio se observaron cinco admisiones STARTED interrumpidas. La
reparación acotada conserva imágenes previas y fencing; no cambia actuaciones,
sus identificadores, términos, alertas o contadores de cola. Las primeras
repeticiones devolvieron DAILY_LIMIT y no se contaron como consultas.
Se esperaron 20 minutos antes de liberar esas admisiones, conservando su historia.

Recuperación secuencial: Cárdenas 76 existentes (request20), segunda instancia
J3 9 (request30), J38/origen J33 44 (request31); cero inserciones. Sandra fue
incorporada por el supervisor automático de las 14:00 UTC; la petición controlada
29 se deduplicó. El expediente grande devolvió546/WORKER_RESOURCE_LIMIT en21,
confirmado por logs; tras el despliegue,37 devolvió200/source_complete=true y
147 existentes, sin inserciones. Los cinco inventarios conservan todos sus IDs
y fingerprints. Peticiones20/21/29/30/31/37 pertenecen a la época
`2026-11-01T13:37:57.428452Z`; un número de pg_net por sí solo no es identidad durable.

SQL aplicado, con ensayos y repetición sin efectos adicionales:

- `coordination/20261101_publication_uuid_acceptance.sql`
- `coordination/20261101_samai_fresh_source_delivery.sql`
- `coordination/20261101_samai_delivery_transport_recovery.sql`
- `coordination/20261101_samai_interrupted_admission_recovery.sql`
- `coordination/20261101_samai_recovered_delivery_request.sql`
- `coordination/20261101_samai_confirmed_cpu_delivery_recovery.sql`

Son operaciones técnicas acotadas ya ejecutadas; no son un paquete para volver
a correr indiscriminadamente. Las tablas de auditoría son privadas y conservadas.
No se desplegó el antiguo paquete histórico SAMAI ni se tocó el término de 30 días.

## Corte final y recuperación del monitor

01/11/2026 **10:54:49 America/Bogota**. La cohorte inicial de 69 asuntos / 138
pares conserva CPNU 43/54, SAMAI 15/15, PP 9/54 y SAMAI Estados 15/15 completos
en origen. La incorporación fresca es 14/54, 15/15, 9/54 y 14/15. PP avanzó de
4 a 9 ventanas actuales: cuatro completadas por `pp-durable-worker-zwxr5` y una
posterior de Pinar. Los cuatro primeros monitores incorporaron automáticamente
sus UUID; sus lectores confirmaron identidad, consulta y persistencia completas.

A las 10:36:11 un cambio concurrente archivó/deshabilitó el asunto
`2e2139bd-546a-401c-9b1b-863216016ee3`, radicado `05001250200020260298900`, y sus
inscripciones. No lo modificó esta intervención; el actor/motivo no está acreditado.
El universo canónico actual es 68/136: CPNU 42/53, SAMAI 15/15, PP 9/53,
SAMAI Estados 15/15. Se conserva la cohorte inicial para no mejorar indicadores
por esa baja. Las matrices incluyen ambas mediciones y sus exclusiones.

**Nuevo SQL preventivo, aplicado sin desplegar otra función Edge:**
`coordination/20261101_monitor_expired_wait_backoff.sql` conserva una espera
aceptada por el backend como PENDING diagnosticado, aunque su presupuesto de
polling esté agotado. Comprueba el UUID y el estado real ADMITIDA/EN_CURSO; no
marca éxito, renueva los 96 polls ni crea una consulta al portal. Las esperas
agotadas se comprueban cada hora sin consumir intentos de fuente. Los errores
reales siguen limitados a tres intentos. El cierre continúa protegido por lease,
expiración y rol service_role; anon/authenticated no tienen EXECUTE.
Definición desplegada MD5 `074446065446f5d0e7203473258bd5d0`.

Prueba con PostgreSQL real aislado: espera normal, agotada, crédito único,
respuesta duplicada/tardía, error real, UUID inválido y rol no autorizado.
La migración tuvo ensayo ROLLBACK y repetición sin efectos adicionales.

`coordination/20261101_recover_verified_expired_waits.sql` recuperó 13 esperas
agotadas, cada UUID contrastado en Cloud SQL y con inscripción elegible. Conserva
before-image, intentos y gate; devuelve solo el último intento que no consultó
la fuente. Un candidato con backend PARCIAL quedó intacto. Producción: once
llamadas ordinarias dejaron PENDING, attempts=2, diagnóstico explícito y siguiente
comprobación a las 11:50 Bogotá; otras dos conservaron una admisión vigente.
Esto es recuperación técnica, no trece consultas nuevas ni cobertura acreditada.

## Pinar: incorporación y documentos comprobados

El UUID actual `6e0bd7f6-a9ac-4010-9fdf-d8f49458a08a` terminó una consulta real
a las 09:54:55 Bogotá. El monitor seguía un UUID antiguo; el SQL
`coordination/20261101_pinar_completed_reader_recovery.sql` guardó la imagen
previa y devolvió solo la última espera. A las 10:25 el monitor ordinario siguió
la referencia actual certificada: dos publicaciones nuevas y dos existentes,
sin repetir el portal. Repetir el SQL afectó cero filas.

Asunto `b422bbc4-23ca-4b18-9e7b-c2b067272cd2`, radicado `66001418900120260088600`:

- Planilla: publicación `b842d174-a2cb-4734-8e12-4da98e7940ae`.
- Providencia: publicación `7554a90e-62cf-4a9d-8d5a-c0106903f10d`.

Ambas proceden del artículo 277661224 del 30/10. El PDF dice **estado 156**,
aunque su nombre es `00ESTADO_157-30_OCTUBRE_2026.pdf`; el número de la fuente
no se reemplaza por el nombre del archivo. Mantener esa distinción al presentarlo.

Se obtuvieron **dos originales**, conservando cuatro asociaciones: tres por el
cron de adjuntos existente y una por llamada acotada al mismo trabajador.
`coordination/20261101_pinar_attachment_acceptance.sql` se ejecutó solo con
ordinal=1; no ejecutar las demás variantes como un paquete de recuperación.
Los dos enlaces emitidos bajo RLS se descargaron realmente: 200, planilla
215.203 bytes / 3 páginas, providencia 119.456 bytes / 4 páginas. Todas las páginas
analizables; radicado, Pinar y Pereira concordantes. Los hashes coinciden con
los originales documentados en la cola. Los campos `sha256_tabla/auto` del feed
pertenecen a copias derivadas; no representan el hash de esos originales.
No se infiere concesión cautelar por el nombre de la providencia.

## Pendientes precisos de integración

`530e0e88-81be-4927-bcbe-ebbcbdbe674a`, radicado `05001333300520250001900`:
consulta positiva de publicaciones a la 01:00 Bogotá, provider unknown y wrapper
source_complete=false. El monitor posterior difiere por DAILY_UPDATE_ALREADY_STARTED
hasta el 2/11 a las 00:00. El backend certifica por separado providencias y las
15 fechas de fijación actuales. No se fuerza SUCCESS ni se interpreta como
restricción del portal. Los lectores entregan la evidencia disponible.

Una copia de La Ceja también se descargó desde el lector autorizado: 7.657.321
bytes y 103 páginas analizables, hash en la evidencia. El hash acredita trazabilidad,
no integridad completa por sí solo. Nicholls conserva las dos entradas del mismo
estado 39; su auto cautelar íntegro sigue pendiente de correspondencia acreditada.
No se recuperaron por ello los seis memoriales ni se cambió 1074556.

**Sin sesión de navegador autorizada:** botones y pantallas WorkItemDetail
siguen sin verificación visual. No se afirma publicación ni aceptación de UI.

El informe completo, matrices individuales, pruebas y manifiesto están en PR1 de
`juanguiremynol-lgtm/Andromeda-`, `docs/daily-sync-acceptance-20261101.md` y
`coordination/daily-sync-release-20261101-acceptance.json`. El próximo diario
es 2/11 a las 02:00/02:10/02:20/02:30 Bogotá; todavía no observado. El 99 % no
se alcanza. No se tocaron la reparación histórica, las dos alertas ni el término
excluidos; tampoco interfaz, RLS, cron o Vault.
