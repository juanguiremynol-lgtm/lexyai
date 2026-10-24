# Conector MCP de Andromeda: gestión de cartera por usuario (alcance corregido)

Sustituye al borrador rechazado. Se trabaja sobre la fuente, el proyecto y el servidor que ya existen. Las 33 herramientas actuales siguen siendo compatibles. Las cuentas, contraseñas y roles de la plataforma quedan fuera. «Verificar correo» significa resolver las preguntas pendientes de vinculación de correos, nunca la verificación del correo de inicio de sesión.

## Fase 0: verificar antes de cambiar (solo lectura)
- Revisar los permisos de ejecución, los dueños y el cuerpo de `set_work_item_lifecycle`, `purge_work_item_acts_and_pubs(uuid)` y `purge_work_item_related_data(uuid)`, y quién los usa: tareas internas, funciones de servidor e interfaz.
- Revisar los triggers BEFORE y AFTER de `work_items`, en especial los AFTER UPDATE OF deleted_at, y el reparto hacia la cola GCP entre expedientes hermanos.
- Revisar las políticas de `work_item_stage_suggestions`, el guardia de preclusión y la configuración manual o de inferencia de etapas.
- Revisar `auth.oauth_consents` y los clientes registrados, solo esquema y conteos.
- Revisar la cola actual `work_item_email_links` (sugerido, confirmado, descartado), cómo convive con `message_links` y qué pantalla usa cada una.
- Revisar qué pantallas usan `notifications`/`notification_user_state` y cuáles `alert_instances`.
- Revisar el flujo real de creación de asuntos: normalización del radicado, límites del plan, duplicados, valores por defecto, catálogo de etapas e inscripción en proveedores.

## Fase 1: cerrar las entradas inseguras ya existentes (migración aditiva)
- Quitar a PUBLIC, anon y authenticated el permiso de ejecutar las dos funciones de purga y la de ciclo de vida. Conservar `service_role`.
- Crear una entrada para usuarios que derive el actor de `auth.uid()`, compruebe la propiedad o el rol de admin de un plan empresarial y rechace actores suplantados.
- Limitar al mismo dueño u organización el reparto hacia la cola GCP.
- Si el cambio de `deleted_at` lo hace solo el trigger BEFORE, los triggers AFTER no se disparan. Por eso, en la misma transacción se ejecutan de forma explícita la limpieza de notificaciones y alertas y la auditoría.
- Reencaminar la interfaz, `src/lib/services/work-item-delete-service.ts` y `src/lib/lifecycle.ts`, hacia la entrada segura.
- No se tocan datos reales de cartera en ninguna prueba.

## Fase 2: permisos de lectura y gestión por usuario y cliente OAuth
- Tabla nueva `mcp_client_grants` con user_id, oauth_client_id, nivel (`read` | `manage`), fechas de concesión y revocación, y quién lo concedió. RLS: el dueño la lee.
- Conceder o revocar solo mediante RPC con una sesión propia de la app. Se rechazan los tokens que traen `client_id`, para que el agente no pueda darse permisos a sí mismo. Se valida que exista un consentimiento OAuth del usuario para ese cliente.
- Sin concesión, el permiso es solo de lectura; no se asigna gestión a los consentimientos existentes. Si el token trae un permiso más estrecho, prevalece ese.
- `requireWriteScope` pasa a `requireManageGrant(ctx)`, que consulta el permiso en la base de datos con el usuario y el `client_id` verificados. La base de datos vuelve a comprobarlo en cada RPC de escritura.
- Interfaz:
  - la pantalla de consentimiento (`/.lovable/oauth/consent`) explica la diferencia entre lectura y gestión y permite elegir;
  - en `ConnectAI` aparece la gestión de conexiones, con revocar y cambiar el nivel;
  - una herramienta de solo lectura, `get_capabilities`, muestra el permiso efectivo.

## Fase 3: base común para escrituras
- Tabla `mcp_idempotency` con llave formada por usuario, cliente, acción y clave, más el hash de la solicitud. Si se repite, devuelve el mismo resultado ya guardado. Si se reutiliza la clave con datos distintos, devuelve conflicto.
- Cada mutación es un RPC SECURITY DEFINER que, en una sola transacción:
  - comprueba el permiso;
  - comprueba la revisión esperada;
  - aplica el cambio;
  - escribe la auditoría (actor y cliente tomados del contexto verificado, antes y después, sin secretos);
  - guarda el resultado de idempotencia.
- Cero filas afectadas o un error nunca cuentan como éxito.

## Fase 4: herramientas nuevas (una por archivo en `src/lib/mcp/tools/`)
- `list_workflow_stages`: catálogo de etapas y transiciones válidas por tipo de proceso.
- `create_work_item`: reutiliza el flujo real de creación (radicado, límites, duplicados, cliente propio, valores por defecto e inscripción). No inventa origen ni etapa.
- `archive_work_item`, `trash_work_item` y `restore_work_item`:
  - mantienen la retención de 10 días;
  - devuelven la fecha límite para recuperar el asunto;
  - respetan la retención legal.
- La purga definitiva no estará disponible por el conector.
- `move_stage`: exige revisión esperada, validación exacta del tipo de proceso y guardia de preclusión. Conserva la configuración manual o de inferencia.
- `list_stage_suggestions` y `resolve_stage_suggestion`: ambas exigen revisión esperada, y la decisión del usuario nunca equivale a ejecutoria.
- `resolve_alert` (`alert_instances`) y `set_notification_state` (`notifications`) llevan tipos separados. Descartar un aviso personal nunca cierra un término.
- `resolve_email_link`: confirmar, rechazar o reasignar en la cola actual, indicando la cola de forma explícita. Valida que el correo y el asunto pertenezcan al usuario, mantiene un único vínculo activo y registra la procedencia manual. Vincular un correo nunca aprueba una etapa.
- `resolve_detected_process`: CREATED, MATCHED_EXISTING o DISMISSED, de forma atómica.
- `list_updates_since`:
  - **Cursor:** compuesto por (detected_at, id), con desempate estable, firmado y limitado al usuario, con caducidad explícita.
  - **Solape:** reconcilia una ventana acotada hacia atrás y deduplica, para no perder confirmaciones que llegan tarde.
  - **Respuesta:** actuaciones y estados por separado, con fecha judicial y fecha de detección distintas, `has_more`, frescura por fuente, y correcciones y archivados.
  - **Límite documentado:** no recibir cambios no prueba que el proveedor respondiera bien.
- Metadatos: corregir las instrucciones antiguas (afirman que no hay ciclo de vida y que solo add_note escribe), las anotaciones y `public/.well-known/mcp.json`. Versión 0.6.0 y nuevo marcador `resourceDocumentation`. Regenerar solo con `scripts/build-mcp.mjs`.
- Añadir reglas en `src/lib/AGENTS.md`.

## Pruebas de aceptación
- **Accesos denegados:** sin sesión, otro dueño, solo lectura o permiso revocado reciben rechazo. Un token OAuth no puede escalar sus propios permisos. Un fallo no deja ninguna mutación.
- **Reintentos y concurrencia:** reintentar tras una respuesta perdida aplica el cambio una sola vez. Resoluciones contradictorias concurrentes no se pisan. Una etapa inválida o desactualizada es rechazada.
- **Avisos y correos:** se mantiene la paridad entre notificaciones y alertas. Vincular un correo no cambia la etapa.
- **Ciclo de vida:** archivar, enviar a la papelera y restaurar respetan la retención y ejecutan la limpieza.
- **Novedades:** más de una página de resultados, timestamps iguales, confirmaciones tardías, correcciones, y cursor falsificado o ajeno.
- **Comprobaciones:** `check:mcp:source`, `check:mcp:artifact`, las pruebas de la app afectadas, la extracción del manifiesto y, al final, una prueba real contra el servidor MCP publicado.

## Despliegue
- Las migraciones afectan de inmediato la base compartida, por eso solo se hacen cambios aditivos y las restricciones de permisos se verifican antes de aplicarlas.
- El conector se publica junto con la app, solo después de verificarlo, y se confirma el marcador público.
- Sin limpieza de datos, sin llamadas a proveedores y sin envíos de correos.
