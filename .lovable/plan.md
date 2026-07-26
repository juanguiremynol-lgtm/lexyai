## Objetivo

Habilitar el envío de correos desde el buzón Outlook del propio usuario (permiso `Mail.Send` ya concedido en Azure para Lex Et Litterae S.A.S), manteniendo el principio de "inferencia, no espejo": se registran metadatos y el vínculo al expediente, nunca el cuerpo completo.

## Cambio de invariante

La integración deja de ser estrictamente de solo lectura. El nuevo contrato es:
- Lectura: `Mail.Read` (sin cambios).
- Escritura: `Mail.Send` únicamente — nunca `Mail.ReadWrite`, nunca acceso a buzones ajenos.

Consecuencia operativa: como el conjunto de scopes cambia, cada usuario ya conectado debe volver a pulsar "Conectar Outlook" una vez para reautorizar. Se detecta comparando los scopes concedidos y se muestra un aviso "Reconecta para habilitar el envío".

## Fase 1 — Base de envío

1. `_shared/outlookGraph.ts`: añadir `Mail.Send` a `GRAPH_SCOPES`, un helper `graphPost` y `getFreshAccessToken(userId)` que refresque el token vencido usando el refresh token cifrado (hoy esa lógica vive dentro de `outlook-sync`; se extrae para reutilizarla).
2. Guardar en `user_email_connections` los scopes efectivamente concedidos (`granted_scopes`) y una bandera derivada `can_send`, poblada en `outlook-callback`.
3. Nueva edge function `outlook-send`:
   - Identidad del llamante vía `resolveCaller`; rechaza si no hay conexión CONNECTED con `can_send`.
   - Validación de entrada (destinatarios, asunto, cuerpo, adjuntos opcionales, `work_item_id` opcional).
   - Llama a `POST /me/sendMail` de Graph con `saveToSentItems: true`.
   - Devuelve error del proveedor con status y cuerpo reales, nunca un 500 genérico.

## Fase 2 — Registro y evidencia

4. Tras un envío exitoso con `work_item_id`, insertar en `work_item_email_links`:
   - `direction: 'sent'`, `matched_by: 'MANUAL_SEND'`, `confidence: 1.0`, `evidence_type` = `MEMORIAL_ENVIADO` cuando el envío se marca como memorial, si no `CORRESPONDENCIA_SALIENTE`.
   - Se guardan asunto, destinatarios, fecha, `has_attachments` y el `internetMessageId`/`webLink` que devuelva Graph. Sin cuerpo.
   - El trigger existente `trg_work_item_email_links_evidence` se dispara solo, de modo que un memorial enviado desde la app cierra el término como `FULFILLED_BY_EMAIL_EVIDENCE` sin intervención.
5. Deduplicación: el sync posterior detectará el mismo mensaje en Enviados; se reconcilia por `graph_message_id`/`internet_message_id` para no duplicar la fila.

## Fase 3 — Interfaz (los cuatro flujos aprobados)

6. **Cliente de correo (`/app/email`)**: en el compositor, selector de remitente — "Andromeda (plataforma)" o "Mi Outlook (correo@dominio)". Con Outlook, el envío va por `outlook-send`; el flujo actual por `email_outbox` queda intacto como predeterminado.
7. **Memoriales y documentos a juzgados**: en el diálogo de envío de documentos generados, opción "Enviar desde mi Outlook", que adjunta el PDF y prellena el correo del juzgado. Marca el envío como memorial para la evidencia.
8. **Respuestas en la pestaña Correos**: botón "Responder" en cada correo vinculado, que abre un compositor con destinatario, asunto `Re:` y vínculo al expediente ya resueltos.
9. Estados vacíos claros: si la conexión no tiene `Mail.Send`, todos los puntos de entrada muestran "Reconecta Outlook para enviar" en vez de fallar.

## Detalles técnicos

- Adjuntos: se usa el envío simple de Graph con `fileAttachments` en base64, limitado a 3 MB por mensaje (límite práctico del endpoint `sendMail`); por encima de eso se avisa al usuario y se sugiere enlace en vez de adjunto.
- El token se refresca justo antes de enviar; un 401 de Graph marca la conexión como `ERROR` con `last_error` y pide reconexión.
- Sin cambios en el cron `outlook-sync-every-30min`.
- Nada de esto altera el remitente de plataforma para alertas, notificaciones ni correos transaccionales.

## Azure — nada pendiente

Los cuatro consentimientos ya concedidos (`Mail.Read`, `Mail.Send`, `offline_access`, `User.Read`) son exactamente los que la implementación requiere. No hace falta tocar la app registration ni el Redirect URI.

## Verificación

- Typecheck y build en verde.
- Envío de prueba desde el cliente de correo y confirmación de que el mensaje aparece en Elementos enviados del buzón real.
- Envío de un memorial contra un expediente con término `SUBSANACION` vigente y confirmación de que el término pasa a `FULFILLED_BY_EMAIL_EVIDENCE` y de que el banner de rechazo presunto desaparece.
- Confirmación de que la fila del sync posterior no duplica el vínculo.
