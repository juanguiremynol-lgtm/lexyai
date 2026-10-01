# Auditoría de términos, alertas, notificaciones y calendario: diagnóstico y propuesta

Solo diagnóstico. No se modificó nada: datos, migraciones, jobs ni despliegues.

## 1. Hallazgos verificados en producción (30/09–01/10)

**Estados de los términos (`work_item_deadlines`, 332 filas)**
- PENDING: 1 (con fecha).
- REQUIERE_REVISION_MANUAL: 42. De ellos, 38 tienen `requires_manual_review=false` y solo 1 de esos 38 tiene fecha. Los 4 del incidente tienen `true` y no tienen fecha.
- Otros estados: HISTORICAL_BACKFILL 106, INVALID_NO_TERM 84, CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR 35 (solo 12 con fecha), DISMISSED 28, VENCIDO_ANTES_DEL_MOTOR 10, FULFILLED 7, VENCIDO_SIN_ACTUACION 6, PRESUNCION_DESCARTADA_POR_AVANCE 5, FULFILLED_BY_EMAIL_EVIDENCE 4, CANCELLED 2, SUGGESTED_BY_PROVIDER 1, VENCIDO_RETRODETECTADO 1.
- Hay 15 estados distintos. No existe un catálogo único que diga cuáles se muestran al usuario.

**Causa de la saturación (confirmada)**
Dos procesos crean alertas de términos:
1. La función `evaluate-deadline-alerts` (diaria, 11:15 UTC) ya usa una huella estable `deadline_TERM_<id>`. Mantiene una sola alerta viva por término y la escala en la misma fila.
2. La función SQL `regenerate_doctrine_alerts()`, del job `alert-doctrine-regenerate` (diario, 11:35 UTC), inserta TERMINO_POR_VENCER / CRITICO / VENCIDO para todo término PENDING que vence en 8 días hábiles o menos. Lo hace con `ON CONFLICT (fingerprint) DO NOTHING`. Pero la huella sale de `alert_source_event_key(...)`, que termina en la fecha de Bogotá. Resultado: una fila nueva por término y por día.
   - Ejemplo: el término 58ed4dd1 (asunto 8fac310f) generó 7 filas entre el 24 y el 30/09, todas con `source_event_key` que termina en la fecha del día.
   - Ejemplo: el traslado del asunto 62de973f generó 1 alerta crítica y 5 vencidas consecutivas entre el 01 y el 06/09.
- Desde el 01/09 hubo 22 alertas DEADLINE_ENGINE. Todas siguen sin leer (`read_at` null), aunque luego quedaron en CANCELLED, DISMISSED o RESOLVED.
- Además hay 30 LEXY_DAILY; 29 ya están cerradas.
- El mismo `regenerate_doctrine_alerts` también crea alertas de audiencias desde la tabla `hearings`, no desde `work_item_hearings`.

**Audiencias:** `work_item_hearings` tiene 109 filas. 101 tienen `scheduled_at` nulo (son marcadores) y solo 3 están en el futuro.

**Preferencias:** `alert_preferences` existe (`user_id`, `preferences` jsonb) pero tiene 0 filas. Hoy el usuario no puede configurar umbrales de días ni canales.

**Calendario externo:** en `src/` y `supabase/functions/` no hay ninguna referencia a VCALENDAR, webcal, calendar.google.com ni enlaces de calendario de Outlook. La funcionalidad no existe.

**Jobs relevantes (sin cambios):**

| Hora UTC | Job | Qué hace |
|---|---|---|
| 10:40 | drain-expired-deadlines | |
| 11:15 | evaluate-deadline-alerts | Alertas de términos |
| 11:15 | age-out-pending-review-deadlines | |
| 11:15 | hearing-reminders | |
| 11:20 | alert-lifecycle-maintenance | |
| 11:35 | alert-doctrine-regenerate | Alertas de términos y audiencias (la que duplica) |
| 11:50 | match-deadline-discharges | |
| 13:00 | andromeda-daily-digest | Resumen diario |
| cada 2 h | scheduled-alert-evaluator | |

## 2. Recorrido del término (resumen)

```text
CPNU / SAMAI / PP / SAMAI Estados
  -> work_item_acts / work_item_publicaciones
  -> classify_providencia + providencia_classification_rules
  -> compute_deadline_for_actuacion / compute_deadline_for_publicacion
     -> resolve_publicacion_anchor -> compute_deadline_from_rule (add_business_days_sql + colombian_holidays)
  -> work_item_deadlines (guard_audit_hold_twin, corroborate_duplicate_deadline)
  -> age_out_pending_review_deadlines / drain_expired_deadlines / match_deadline_discharges
  -> alert_instances  [evaluate-deadline-alerts (estable) + regenerate_doctrine_alerts (diario, duplica)]
  -> alert-lifecycle-maintenance (cancela o resuelve)
  -> NotificationCenter / tablero / pestaña del asunto
  -> scheduled-daily-digest (tabla de términos + bloque de revisión manual)
```

Dos búsquedas en paralelo están cerrando el mapa exacto de archivos y líneas: hooks y componentes del tablero, centro de alertas, calendario interno y audiencias. Se agregará como anexo antes de implementar. No cambia las prioridades de abajo.

## 3. Qué ve el usuario (matriz propuesta como regla única)

| Estado | Tablero | Asunto | Calendario | Centro de alertas | Correo |
|---|---|---|---|---|---|
| PENDING con fecha | Sí | Sí | Sí, fecha confirmada | Una alerta viva, escalada por hitos | Sí |
| REQUIERE_REVISION_MANUAL | Sí, bloque "Revisión" | Sí | No como fecha; aparece en la lista "sin fecha" | Una sola alerta informativa | Bloque de revisión |
| SUGGESTED_BY_PROVIDER | No | Sí, como sugerencia | No | No | No |
| HISTORICAL_BACKFILL / PENDING_REVIEW | No | Sí, como historial | No | No | No |
| VENCIDO_* | Solo si no hay cierre | Sí | No | Una alerta de vencido, sin repetirse cada día | Sí, una vez |
| CERRADO_POR_CORRESPONDENCIA_SIN_VERIFICAR | Bloque "Verificar cierre" | Sí | No | No | Resumen semanal o nunca |
| FULFILLED*, DISMISSED, CANCELLED, INVALID_NO_TERM, PRESUNCION_DESCARTADA | No | Sí, en historial | No | No | No |

**Regla de coherencia:** `status = REQUIERE_REVISION_MANUAL` implica `requires_manual_review = true`. Hoy 38 filas lo contradicen.

## 4. Propuesta mínima por prioridad

**P0 — corrección**
1. Que `regenerate_doctrine_alerts` deje de insertar alertas de términos. El único productor será `evaluate-deadline-alerts`, que ya usa la huella estable. Se mantiene la parte de audiencias, revisando que use la tabla correcta.
2. Unificar la semántica de revisión manual. Respaldar las 38 filas inconsistentes y poner `requires_manual_review=true`, sin tocar ni fechas ni estados. Agregar una regla en la base que mantenga ambos campos sincronizados desde ahora.
3. Revisar en `drain_expired_deadlines` y `alert-lifecycle-maintenance` que una alerta cancelada no quede contada como "sin leer". Al cerrar una alerta se marca `read_at`, o el contador cuenta solo las alertas vivas.

**P1 — menos fatiga**
4. Avisos por hitos: 8 (aviso), 3 (crítico), 1, 0 y vencido. Una sola fila por término, que se actualiza en cada hito, con su historial. Después de vencido no se repite cada día.
5. Preferencias mínimas en `alert_preferences.preferences`: qué hitos avisar, si mostrar solo críticos y si el correo es diario o solo cuando hay críticos. El valor por defecto es igual al comportamiento actual.

**P1 — calendario externo (sin conectar cuentas)**
6. Una función nueva `calendar-ics`. Entrega un archivo .ics de un término PENDING o de una audiencia con fecha, usando un enlace firmado de un solo uso (la infraestructura de `digest_document_tokens` ya existe).
   - Contenido: zona horaria America/Bogota, título "Vence: <tipo> — <radicado>", descripción con el despacho y el enlace al asunto en Andromeda.
   - Seguridad: sin datos de otros clientes. El enlace se valida por dueño y organización, y vence en 30 días.
7. Enlaces "Añadir a Google" y "Añadir a Outlook", generados con la misma información. No se ofrecen para términos sin fecha ni para revisiones manuales.
8. Dónde ponerlos: la tabla de términos y las audiencias del resumen diario, la tarjeta de término del asunto, la ficha de audiencia y el calendario interno.

**P2 — opcional**
9. Resumen semanal de cierres "por correspondencia, sin verificar".
10. Atribuir la parte (hoy `bound_party_role` está en DESCONOCIDO) a partir de los sujetos procesales, con revisión visible.

## 5. Pruebas de regresión
- Un término que pasa por 8, 3, 1, 0 días y vencido produce una sola fila de alerta con el historial de escalamiento. Correr el job dos veces el mismo día no crea filas nuevas.
- `regenerate_doctrine_alerts` ejecutado en una transacción que se deshace inserta 0 alertas de términos y sigue insertando alertas de audiencias.
- Sincronización de revisión manual: un intento de update inconsistente queda corregido o se rechaza.
- El .ics se valida con una prueba de formato (DTSTART con TZID America/Bogota y el enlace profundo). Un token de otro dueño recibe 403. Un término sin fecha recibe 404.
- Las pruebas actuales siguen pasando: `incident_20260930.sql` y `render_incident_test.ts`.

## 6. Despliegue seguro
1. Antes de cada cambio, respaldar las definiciones de las funciones en `docs/rollback/`.
2. Primer paso, P0.1: un cambio solo en `regenerate_doctrine_alerts`. Observar una corrida de las 11:35 y contar las alertas DEADLINE_ENGINE nuevas por término (deben ser ≤1).
3. Después, P0.2 y P0.3, con respaldo de las filas afectadas.
4. Después, P1: preferencias, .ics y enlaces en el resumen, mostrado con un render local antes de desplegar `scheduled-daily-digest`.
5. Sin jobs nuevos, sin correos de prueba reales y sin cambios a RLS.
