# Incorporación de certificados públicos posteriores

Base de aplicación: `3cb51c3c4d5f30a2be64262dc7455a8c292492d2`.
Proyecto Lovable Cloud comprobado: `fd922a87-5316-40ea-97b8-727cf903a9b8`,
workspace `K3yqj3oLkT8fmR0NUANt`, backend `qvuukbqcvlnvmcvcruji`.

El certificado PP `480e06b5-07c9-44b5-a3dc-90608ceeb93d` del proceso
`05001400301120260144800` acredita la ventana 18/10–1/11 y la observación real
`2026-11-01T23:09:42.563295Z`. El monitor había agotado tres intentos con
`PENDING_UPSTREAM`. Al reanudarlo, el caller volvió a diferirlo por
`DAILY_UPDATE_ALREADY_STARTED`, aunque el certificado estaba completo: el
ledger PP estaba cerrado y el canal diario, `PENDING_UPSTREAM`.

La corrección permite exclusivamente incorporar un resultado almacenado
identificado, completo, persistido, fresco y correspondiente a la ventana
actual. No admite otra extracción, no hace POST al scraper, no abre SAMAI,
no desplaza una extracción activa y no rejuvenece la observación de fuente.
Se conserva la separación de la consulta reciente y el histórico pendiente.

Orden compatible:

1. Aplicar `coordination/20261101_pp_stored_read_claim.sql`: RPC interno, solo
   service role, habilitación por fuente y exclusión por asunto, una reserva
   de lectura almacenada por hora y asunto para todos los invocadores.
2. Aplicar `coordination/20261101_pp_monitor_ingestion_credit.sql`: oportunidad
   adicional de incorporación vinculada al ledger privado y con vencimiento
   del certificado. Conserva contadores, historial, firma y permisos del RPC.
   La autorización sobrevive a una respuesta diferida; al vencer termina con
   causa explícita. No amplía las consultas al proveedor.
3. Publicar **únicamente** `sync-publicaciones-by-work-item` con el nuevo
   módulo compartido. Conservar configuración, autenticación y demás funciones.
4. Una vez comprobada la publicación, ejecutar la reanudación acotada
   `coordination/20261101_pp_resume_certified_ingestion.sql`; repetirla no
   concede otra oportunidad. El monitor ordinario debe validar e incorporar.

Pruebas locales: tres regresiones del certificado (incompleto→completo,
identidad/ventana/reloj incorrectos y repetición sin alterar el reloj) ejecutadas
con Node 24 y `node:test` sobre el mismo módulo TypeScript; comprobación de
sintaxis del caller. PostgreSQL aislado en 55439 verifica un ganador concurrente,
privilegios internos, conservación de autorización al diferir y expiración.
Estas pruebas no sustituyen el resultado productivo del monitor.

No se cambian interfaz, MCP, cron, Vault, reparación histórica SAMAI,
audiencias, alertas excluidas ni el término de treinta días.
