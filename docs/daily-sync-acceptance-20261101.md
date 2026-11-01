# Coordinación de aceptación: 1/11/2026

Main de Lovable preservado hasta `100615a2a645527da4ba4697f215381cf0cd963a`.
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

## Corte de aplicación y pendientes precisos

01/11 09:23:00 Bogotá: 69 asuntos elegibles /138 pares; mismas inscripciones.
SAMAI actuaciones:15 incorporaciones frescas confirmadas. PP:4 resultados de la
ventana reciente actual,37 monitores pendientes/13 fallidos. CPNU:42 resultados
históricos success/empty,4 partial y8 error; solo12 tienen prueba completa de
fuente todavía fresca incorporada, separada de la cobertura backend43/54.
SAMAI Estados:14 monitores SUCCESS y uno PENDING por DAILY_UPDATE_ALREADY_STARTED.

Caso preciso pendiente de proyección/seguimiento:
`530e0e88-81be-4927-bcbe-ebbcbdbe674a`, radicado `05001333300520250001900`.
La consulta positiva de publicaciones de01:00 Bogotá fue registrada con provider
`unknown` y source_complete=false en el wrapper, aunque con status=success y
source_observed_at=06:00:21.307Z. El monitor posterior queda PENDING hasta2/11
00:00 por la guarda diaria. El backend acredita por separado providencias y15/15
fechas de fijación actuales; no es un rechazo del portal ni prueba de expediente
privado. Se conserva esa distinción, sin forzar SUCCESS ni recrear publicaciones.

Un lector autorizado emitió la URL de una copia de La Ceja y la descarga real
devolvió200:7.657.321 bytes,103 páginas analizables,
SHA-256 `65b2a424968048e73ad5e13cc7242cdf63b62d546db2511f49f38bfa2c8dcc15`.
Se acredita lectura de esa copia; el hash es trazabilidad y no integridad completa.
No se recuperó por ello el auto cautelar íntegro de Nicholls ni anexos pendientes.

**Sin sesión de navegador autorizada:** la comprobación visual y los botones de
WorkItemDetail siguen pendientes. No se afirma publicación/verificación visual.

El informe completo, matriz de138 pares,15 SAMAI,11 CPNU y la comparación de
cohortes PP están en la PR1 de `juanguiremynol-lgtm/Andromeda-`,
`docs/daily-sync-acceptance-20261101.md` y su directorio de evidencias.
Manifest: `coordination/daily-sync-release-20261101-acceptance.json`.
No se alcanza99 % ni se certifica toda la continuidad diaria.
