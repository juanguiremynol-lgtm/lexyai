# Ampliar el conector MCP de Andromeda: gestión de cartera por usuario

## Resultado de la auditoría (solo lectura)

**Fuente canónica y despliegue**
- Fuente: `src/lib/mcp/index.ts` (`defineMcp`, v0.5.1) y una herramienta por archivo en `src/lib/mcp/tools/` (33 hoy). Utilidades: `src/lib/mcp/shared.ts` (`sbForUser`, `requireAuth`, `requireWriteScope`, `resolveWorkItem`).
- `supabase/functions/mcp/index.ts` se genera con `mcpPlugin()` (`vite.config.ts`, `scripts/build-mcp.mjs`). Nunca se edita a mano.
- Comprobaciones: `check:mcp:source` (`tsconfig.mcp.json`) y `check:mcp:artifact` (`scripts/check-mcp-artifact.ts`), además de `app_mcp_server--extract_mcp_manifest`. Hoy solo existe la prueba `src/test/mcp-runtime-env.test.ts`.
- Despliegue: el conector se publica solo al publicar la app. Hay que cambiar el marcador `resourceDocumentation` en cada versión y confirmarlo en `/functions/v1/mcp/.well-known/oauth-protected-resource`. Las migraciones se aplican con la herramienta de migraciones y quedan activas de inmediato, porque vista previa y producción comparten una sola base de datos.
- Inicio de sesión: OAuth emitido por el propio backend, con `requireOAuthClientClaim`. Los tokens no traen `scope`, así que `requireWriteScope` concede escritura a cualquier token aprobado. RLS se aplica con el token del usuario.

**Rutas existentes que se reutilizarán (no se duplica lógica)**
- Archivar/eliminar recuperable: RPC `set_work_item_lifecycle` (SECURITY DEFINER). Cambia estado, `deleted_at` y `purge_after` (+10 días), desactiva monitoreo, cancela trabajos, escribe `audit_logs` y encola `gcp_lifecycle_outbox`. El servicio `src/lib/services/work-item-delete-service.ts` añade autorización de dueño/admin, retención legal, `work_item_soft_deletes` y `atenia_ai_actions`.
- Borrado definitivo: solo la función `delete-work-items` (clave de servicio). `work_items` no tiene política DELETE para usuarios. La política del proyecto prohíbe a los usuarios borrar de forma definitiva fuera de la papelera.
- Restaurar: `src/hooks/use-restore-work-items.ts`.
- Etapas: `src/hooks/useStageSuggestion.ts` actualiza `work_item_stage_suggestions` y `work_items` directamente. `work_item_stage_suggestions` UPDATE solo lo permite a «org admins»; falta verificar el caso de un abogado SOLO. Además existen `accept_workflow_suggestion` y `apply_system_computed_stage` (tipo de proceso / sistema), y el guardia de preclusión en BD.
- Avisos: `set_notification_user_state(_ids, _action, _until)`, un estado personal que no altera el historial compartido.
- Correos: `message_links`, con políticas propias del dueño para crear, actualizar y borrar. La interfaz inserta `MANUALLY_LINKED` y marca `inbound_messages.processing_status='LINKED'` (`src/components/email/EmailLinkDialog.tsx`).
- Procesos detectados: `detected_processes` con estados PENDING/DISMISSED/CREATED (`src/hooks/use-detected-processes.ts`).
- Lecturas incrementales: hoy `get_actuaciones_hoy` y `get_estados_hoy` (día de Bogotá) y `list_actuaciones` / `list_publicaciones`. No existe un cursor estable por `detected_at`.

## Alcance mínimo coherente (nuevas herramientas, mismo servidor)

1. **Permiso explícito por acción.** Nuevo `requireConfirm(args.confirm)`: toda acción que cambie estado exige `confirm: true`, y el asistente debe pedirlo al usuario. El borrado definitivo exige además repetir el radicado exacto. Se mantienen `requireWriteScope` y RLS.
2. **`create_work_item`**: radicado, tipo de proceso, cliente y partes. Inserta con el token del usuario (política existente) y `source='MANUAL'`. No calcula términos ni etapa.
3. **`archive_work_item` / `restore_work_item`**: usan `set_work_item_lifecycle` (ARCHIVED, DELETED recuperable, ACTIVE), con la misma comprobación de retención y el registro en `work_item_soft_deletes` / `atenia_ai_actions`. Esa lógica se traslada a un módulo puro compartido por la interfaz y el conector.
4. **`purge_work_item`** (eliminación definitiva): solo para asuntos que ya están en la papelera, con doble confirmación, mediante la función existente `delete-work-items`. **Bloqueante de política:** contradice la regla del proyecto «sin borrado definitivo para usuarios fuera de la papelera». Requiere decisión del propietario; por defecto no se incluye.
5. **`move_stage`**: cambio manual de etapa con procedencia `MANUAL_USER`, respetando el guardia de preclusión, que puede rechazar el cambio. No cambia tipo de proceso ni radicado.
6. **`list_stage_suggestions` / `resolve_stage_suggestion`**: aceptar, rechazar o posponer, reutilizando la lógica de `useStageSuggestion.ts` en un servicio compartido. La aceptación queda como decisión del usuario, nunca como firmeza.
7. **`dismiss_alert`**: leído, descartado o pospuesto mediante `set_notification_user_state`. No resuelve términos.
8. **`resolve_email_link`**: confirmar, rechazar o reasignar un vínculo correo-asunto en `message_links`, sin leer cuerpos.
9. **`resolve_detected_process`**: descartar, o vincular a un asunto existente o recién creado.
10. **`list_updates_since`**: actuaciones y estados con `detected_at > cursor`, en listas separadas (actos ≠ estados), con su procedencia y un cursor de salida.
11. **Auditoría:** cada escritura vía conector deja `actor='MCP'` y `client_id` OAuth en `audit_logs` / `atenia_ai_actions`, mediante un RPC SECURITY DEFINER `log_mcp_action` (migración nueva). La inserción en `audit_logs` hoy es solo del servicio.
12. Se actualizan las instrucciones de `defineMcp`, la versión 0.6.0 y el marcador de revisión. Se añade una regla en `src/lib/AGENTS.md`.

**Fuera de alcance:** cuentas, roles, seguridad de plataforma, verificación de correo de inicio de sesión, herramientas `atenia_*` de escritura, recálculo de plazos y cambios en proveedores.

## Pruebas de aceptación (`src/test/mcp-*.test.ts`)
- Sin `confirm: true`, ninguna escritura llega a la BD.
- Archivar y restaurar recuperan el asunto. Eliminar deja `purge_after` a +10 días. La retención legal bloquea.
- Un asunto de otro usuario devuelve «no encontrado» (RLS), sin filtrar datos.
- `move_stage`: el guardia de preclusión rechaza un retroceso, y se conserva la etapa manual.
- `resolve_stage_suggestion` no altera términos.
- `dismiss_alert` es idempotente y afecta solo al usuario.
- Reasignar un correo deja un único vínculo activo.
- `list_updates_since` no repite elementos entre dos llamadas y separa actos de estados.
- Se generan las 33 herramientas actuales más las nuevas. Pasan la comprobación de fuente y la de artefacto.
- Tras publicar, el marcador queda visible en el endpoint público. Las llamadas `tools/call` reales desde ChatGPT siguen bloqueadas por la renovación OAuth pendiente.

## Bloqueos y decisiones
- **Borrado definitivo vía conector:** necesita aprobación explícita del propietario contra la regla actual.
- **Política de sugerencias de etapa:** confirmar en BD si un usuario SOLO puede actualizarlas. Si no puede, hace falta un RPC acotado al dueño.
- **Prueba real extremo a extremo:** depende de que ChatGPT complete una autorización nueva. La anterior seguía con un token de renovación inválido.
