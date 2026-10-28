# Atenia: seguridad del supervisor y resultados de reintentos

Base: `fd2350bbd4d883adfccfbb24733b135dab59c89d`. Esta rama no despliega ni modifica cron.

El supervisor tenía `verify_jwt=false` y carecía de control en el handler. Al dotar a sus invocaciones de un bearer de servicio era imprescindible impedir que un tercero anónimo activara ese trabajo. El handler admite la clave técnica de cron, identidad de servicio verificada o un usuario validado y presente en `platform_admins`. Rechaza los demás antes de la primera consulta de negocio. `RETRY_ACTS`, `RETRY_PUBS`, `RETRY_PUBS_HEAVY` y el chequeo de integración envían identidad de servicio explícita; una respuesta sin `ok:true`, parcial, pendiente o con errores conserva la tarea para reintento acotado. Una fuente no aplicable o un asunto pausado quedan `SKIPPED`, no `DONE`. La finalización compara estado e intento para que una respuesta tardía no cierre una concesión reemplazada. El modo de simulación no reclama ni consume intentos de la cola.

La cadena de `scheduled-daily-sync` y `atenia-server-heartbeat` envía la identidad de servicio explícitamente. El watchdog ya lo hace. Se protege también el heartbeat: era público y habría permitido iniciar el supervisor mediante un intermediario.

## Activación coordinada pendiente

1. Confirmar el `main` y las revisiones vigentes; conservar y reconciliar cualquier cambio posterior. Tomar respaldo privado de la definición vigente del cron 8 sin publicarla y verificar que el runtime de heartbeat dispone de la misma `CRON_SERVICE_KEY` técnica que Vault, sin revelar su valor.
2. El cron 8 `atenia-server-heartbeat` se observó activo, `0 */6 * * *`, con un bearer de rol `anon`. No desplegar la protección de heartbeat hasta coordinar el cambio de su cabecera, porque dejaría de funcionar. Aplicar `coordination/20261028_atenia_heartbeat_cron_auth.sql` y desplegar inmediatamente el heartbeat compatible; la migración conserva horario, destino y cuerpo, y resuelve el secreto de Vault al ejecutar. Evitar disparos entre ambos pasos.
3. Desplegar la versión compatible de `scheduled-daily-sync` y el supervisor protegido. Comprobar el cron 78 y la llamada de servicio, así como acceso del administrador. El cron 78 observado usa `x-cron-key`, y su valor coincide con el secreto de Vault; esa igualdad no demuestra por sí sola la configuración del runtime.
4. Releer la configuración sin imprimir secretos y verificar una llamada real autenticada, un rechazo no autorizado y el resultado persistido de un reintento real. Si falla, restaurar la revisión anterior junto con el comando cron respaldado y revisar el acceso indirecto; no dejar un cron anónimo llamando al heartbeat nuevo.

Pruebas aisladas: validación de credenciales, semántica de respuestas, invocación del handler con red simulada, reintento parcial y protección frente a una concesión reemplazada; migración en PostgreSQL local, incluida repetición idempotente. Ninguna prueba local acredita una ejecución real en producción.
