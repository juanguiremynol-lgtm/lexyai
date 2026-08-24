# Corrección: notificaciones por correo (D1–D6)

Diagnóstico confirmado contra la base de datos y el código. Nada se ha cambiado.

## Inventario de remitentes al usuario final

Consultando `email_outbox` (única vía de salida en Andromeda) los correos del 24/08 son:

| Hora COT | Origen real | Veredicto |
|---|---|---|
| 02:52 | **no existe fila en `email_outbox`** — no lo envió Andromeda | Externo (Cloud Run/Scheduler). Desactivar allá |
| 06:15 | `dispatch-update-emails` (cron `*/15`) | Se conserva sólo como excepción opt-in |
| 06:30 | `scheduled-daily-digest` (cron `30 11 * * *` UTC) | **Canal por defecto** |
| 07:15 | `dispatch-update-emails` | idem 06:15 |

Otros remitentes existentes, no implicados en novedades judiciales y que se conservan:
`hearing-reminders`, `peticion-reminders`, `send-reminder`, `manage-alert-email`
(verificación), `send-signing-email` / `send-signing-otp` (firma), `verify-generic-email`,
`notify-waitlist-launch`, `atenia-daily-report` (interno de plataforma, no al abogado).

## D1 — Dos canales notifican el mismo hecho: confirmado

Ambos leen fuentes distintas del mismo hecho (`alert_instances` vs. `work_item_acts`)
y no se conocen entre sí. La actuación «Envío de Comunicación – MAU» salió a las 06:15
y volvió a salir dentro del resumen de las 06:30.

Cambios:

1. Nueva tabla `notification_dispatch_ledger` (hecho + canal + fecha), con clave única
   por `(entity_kind, entity_id, recipient_user_id)`. Un hecho despachado por un canal
   no vuelve a despacharse por otro.
2. `scheduled-daily-digest` escribe en el ledger todo lo que incluye;
   `dispatch-update-emails` consulta el ledger antes de encolar y viceversa.
3. `dispatch-update-emails` deja de ser el comportamiento general: sólo despacha cuando
   la preferencia del usuario lo habilita, y sólo para las excepciones declaradas
   (audiencia programada, término que vence, notificación personal).
4. Preferencias por usuario en `alert_preferences.preferences` (ya existe), no
   constantes en código: `channel_default: 'DIGEST'`, `immediate_events: [...]`,
   más excepción por asunto en `work_items.notification_override`.

## D2 — El resumen corre antes de la sincronización: confirmado

`andromeda-daily-digest` = 11:30 UTC; `daily-sync-7am-cot` = 12:00 UTC. El resumen
siempre reporta el ciclo anterior.

Cambio: encadenar por finalización. `scheduled-daily-sync` invoca el resumen al cerrar
su corrida (con el mismo candado de idempotencia por día). El cron horario se conserva
como red de seguridad, movido a las 13:30 UTC (08:30 COT), y sólo actúa si el día no
tiene resumen. El correo declara explícitamente la ventana cubierta.

## D3 — El backfill se cuenta como novedad: confirmado, y el campo ya existe

`work_item_acts.is_notifiable` y `work_item_publicaciones.is_notifiable` ya distinguen
importación inicial de novedad real (triggers `handle_actuacion_notifiability` /
`handle_publicacion_notifiability`: falso mientras no exista
`acts_initial_sync_completed_at`, o si el acto es anterior a la creación del asunto).
**El resumen simplemente no lo consulta.** No hay que crear ningún campo.

Recuento verificado de la ventana de hoy (23/08 11:30Z → 24/08 11:30Z):

- filas detectadas: **33**
- novedades reales (`is_notifiable = true`): **7**
- historial importado: **26** (CPACA reactivados 05001333301820200006501 con 16 filas
  de 2021–2025, y 05001333300320190025201 con 9 filas)

Cambios: filtrar por `is_notifiable` en el conteo del resumen y reportar el historial
aparte como «historial importado (N filas, del AAAA al AAAA)», más una línea única
«expediente reactivado».

## D4 — Los dos reportes se contradicen: el de las 02:52 es externo

No existe fila en `email_outbox` a esa hora, el remitente es `monitoreo@` (Andromeda usa
`info@`) y no corresponde a ningún `cron.job`. **No se corrige desde aquí.** Se entrega
especificación aparte (abajo) para Cloud Run / Cloud Scheduler; la recomendación es
desactivarlo por quedar subsumido en el resumen consolidado.

## D5 — PDF descargable desde el correo

Estado real: el resumen diario **ya** usa enlace autenticado (`digest-document?t=…`,
token por documento y destinatario, 30 días, revalidado contra `v_monitored_work_items`,
URL firmada de 10 minutos generada al hacer clic). No se incrustan URLs firmadas.

Lo que falta y se corrige:

1. `dispatch-update-emails` no emite ninguna columna de documento — de ahí que el estado
   con PDF no fuera descargable. Se le añade la misma emisión de tokens.
2. Desajuste de vocabulario en `estado_attachment_queue`: el worker escribe/lee
   `pending|done|failed`, pero la tabla contiene `downloaded` (331) y `skipped` (40).
   Se unifica el vocabulario y se corrige la lectura.
3. Tri-estado explícito en ambos correos: **Disponible** / **Pendiente de descarga**
   (en cola) / **El despacho no publicó documento** / **Aún no consultado**.
4. Lo mismo para actuaciones con documento (`documentos_observados_en`), no sólo estados.

## D6 — Hallazgos operativos (se reportan)

1. `outlook-token-refresh-every-15min` está activo y corriendo. No evita el vencimiento
   porque lo que caduca no es el token de acceso sino el consentimiento del buzón: eso
   requiere reconexión del usuario. Se añade aviso anticipado accionable (ya presente en
   el resumen) más enlace directo de reconexión.
2. **Discrepancia con el reporte externo**: los dos radicados CGP que él reporta con
   109 días sin lectura (05607408900120230027900 y 05607408900120250017100) tienen
   `last_successful_sync_at = 2026-08-24 11:00Z` en Supabase, ambos ACTIVE y monitoreados.
   El dato del reporte de las 02:52 es falso. Refuerza el punto D4: mientras existan dos
   reporteros, uno miente.

## Punto que considero equivocado (entregable 8)

El documento asume que el reporte de las 02:52 y las «109 días sin lectura» describen la
realidad. La base de datos dice lo contrario para esos dos radicados. Recomiendo no
tocar el planificador por esa señal: el defecto está en el reportero externo.

## Especificación para Cloud Run / Cloud Scheduler (fuera de Lovable)

- Identificar el job que envía «Reporte Diario Andromeda» desde `monitoreo@` (~07:52 UTC).
- Acción recomendada: **desactivarlo**. El resumen consolidado de Andromeda lo subsume.
- Si se conserva, debe: (a) dejar de escribir al abogado y enviarse sólo a operación,
  (b) dejar de calcular «sin primera lectura» por su cuenta y leer el estado de Supabase,
  (c) cambiar el asunto para que no se confunda con el resumen del despacho.

## Detalles técnicos

- Migración: `notification_dispatch_ledger` (+ GRANT + RLS por propietario/servicio),
  columna `notification_override` en `work_items`, normalización de estados en
  `estado_attachment_queue`.
- Edge functions tocadas: `scheduled-daily-digest`, `dispatch-update-emails`,
  `scheduled-daily-sync` (encadenado), `process-estado-attachments-queue`.
- Cron: reprogramar `andromeda-daily-digest` a `30 13 * * *` como respaldo.
- Pruebas: doble notificación bloqueada por el ledger; `is_notifiable` filtra las 26
  filas de historial y deja 7; encadenado sync→resumen; tri-estado de documento;
  enlace de documento en el correo por evento.
