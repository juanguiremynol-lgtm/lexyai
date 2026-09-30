# Auditoría del resumen del 30/09/2026: diagnóstico y reparación mínima

Hoy no se ha cambiado nada. Todo lo de abajo sale de leer el código y los datos actuales.

## Diagnóstico: los cuatro términos

Causa raíz común: la tabla `providencia_classification_rules` asigna el tipo de providencia con expresiones regulares amplias sobre la descripción de la actuación. La regla que coincide decide el término sin leer el auto, y no hay ninguna lista de exclusión. `bound_party_role` queda en DESCONOCIDO porque el motor no extrae el destinatario del término, y por eso los cuatro salen en "PARTE NO DETERMINADA".

| Término | Regla que coincidió | Texto que la disparó | Error |
|---|---|---|---|
| 58ed4dd1 (…0142400) | 7c00959c `NOTIFICACI[OÓ]N\|NOTIFICA` (prioridad 85), en CPACA → RESPUESTA_NOTIFICACION, 3 días | acto SAMAI 0ea70add "Comunicacion al correo… EL AUTO QUE NOTIFICA POR ESTADOS" | Una comunicación secretarial del estado se tomó como notificación que abre un término propio. El término real (corregir la demanda inadmitida, 3 días) viene del auto del 22/09 y no se clasificó como tal. Otros dos actos del mismo día (6d73577a y 3d7bae22) quedaron como corroboraciones, sin crear términos gemelos. |
| 0834a576 (…0063800) | 134925aa `…\|REQUERIMIENTO\|REQUIERE\|DESISTIMIENTO` (editada el 12/09) → RESPUESTA_REQUERIMIENTO | CPNU 70899e74 "Auto Ordena - Corre traslado escrito desistimiento de pretensiones" | La palabra suelta `DESISTIMIENTO` convierte un traslado en requerimiento. Destinatario, días y fecha de inicio salen de la regla, no del auto. |
| d36aecee (…0013900) | 7c00959c `NOTIFICA` sobre el texto de la publicación ("Auto tiene notificado por conducta concluyente"), anclaje AUTO_VIA_FIJACION | publicación 41fbceb8. El acto b5a57c90 quedó como corroboración | Una constancia de notificación a un tercero (la aseguradora) abre un término de 3 días para "parte desconocida". El acto anulado 15b647a9 no creó término en este registro, pero ninguna regla excluye "ERROR DE INGRESO / Actuación anulada". |
| 658ba77a (…0013300) | 8c2af269 `SENTENCIA\|FALLO` (prioridad 40) → RECURSO_APELACION_SENTENCIA, 10 días | SAMAI a8220138 "Auto que resuelve… Resolver el asunto mediante sentencia anticipada" | Un auto que anuncia una sentencia anticipada se clasificó como sentencia proferida. El 13/10 es el vencimiento calculado de una supuesta apelación, no una fecha programada. Probablemente sea un traslado para alegatos (hay alegatos recibidos el 29/09), pero debe confirmarse con el PDF. |

Hay dos defectos más de fondo:
- **Sin exclusiones:** la clasificación no tiene lista negativa (comunicación, constancia, anulada, error de ingreso, "mediante sentencia anticipada", traslado).
- **Notificación genérica:** la regla genérica de notificación tiene prioridad 85, más alta que otras más específicas, y en CPACA se asigna a RESPUESTA_NOTIFICACION aunque ninguna norma fije un término de respuesta a la notificación en sí.

## Diagnóstico: el texto breve

Las frases "CRÍTICO venció notificación ayer", "dos vencimientos urgentes 05/10" y "sentencia programada 13/10" no aparecen en ninguna plantilla del resumen (`scheduled-daily-digest/html.ts`), en las alertas de términos ni en WhatsApp. El origen no está localizado. Lo más probable es un cliente externo (por ejemplo, un asistente conectado por el MCP) que resumió la tabla del correo, pero eso no está confirmado. Como paso de verificación se propone buscar en `client_wa_sends`, `email_outbox` y `atenia_assistant_messages` del 29–30/09, solo en modo lectura.

## Diagnóstico: el correo HTML

1. **"0 sin confirmar" con 43/44 respondidas:** `_shared/sourceRunQuality.ts` calcula lo no confirmado solo como `pending_upstream + error`. El asunto que no tuvo ningún intento no entra en esa suma, así que el encabezado y la frase no suman igual.
2. **SAMAI 15/15, "0 con datos", pero 3 novedades:** `success_count` sale de la RPC `source_collection_quality` (por el estado del intento), mientras que las novedades cuentan filas detectadas en la ventana. Son dos definiciones distintas y el correo no las concilia. Hay que revisarlo en la RPC.
3. **PP 0/44 con 10 PENDING_UPSTREAM y SAMAI Estados 0/15:** siguen la regla de historia por canal. Hay que verificar si hubo corrida ese día (monitor por lotes, cambiado el 29/09) antes de atribuir la causa a la fuente.
4. **Tabla de 17 asuntos que "nunca entregaron":** en `scheduled-daily-digest/index.ts` (alrededor de la línea 400), `other_channel_delivers` se marca solo porque el otro canal tiene filas. Después, `html.ts:532` afirma "el despacho no alimenta esta fuente", aunque la fuente esté respondiendo PENDING_UPSTREAM o con fallos. Es afirmar una causa a partir de un silencio. Además, NEVER_ANSWERED no distingue entre "contesta sin datos", "pendiente de su lado" y "falla".
5. **Proceso privado:** el texto ya dice "afirmación suya, sin comprobar". Se mantiene así, contado como lectura respondida.

## Plan mínimo de reparación (siguiente turno, con aprobación)

1. **Reglas de clasificación (migración):**
   - Quitar `DESISTIMIENTO` suelto de 134925aa.
   - Añadir una lista negativa: comunicación, constancia, "tiene notificado", "anulada", "error de ingreso", "sentencia anticipada", "corre traslado".
   - Lo que coincida con la lista negativa queda como REQUIERE_REVISION_MANUAL y no crea un término PENDING.
   - La regla genérica NOTIFICA deja de crear términos por sí sola (`triggers_deadline=false`, o revisión manual).
   - Los términos existentes no se recalculan.
2. **Los cuatro registros:** una migración auditada y reversible solo sobre los 4 IDs. Pasan a `REQUIERE_REVISION_MANUAL` con una nota que cite la evidencia, guardando el estado anterior en una tabla de respaldo y un script de reversión en `docs/rollback/`. No se marcan como cumplidos ni se crean términos nuevos hasta leer los PDF.
3. **Correo:**
   - Frase de "sin confirmar": `expected - answered`.
   - Quitar "el despacho no alimenta esta fuente". Se sustituye por "el canal de X sí entrega; la causa del silencio no está verificada", y solo cuando la fuente contesta vacía. Si la fuente está en PENDING_UPSTREAM o fallando, se dice eso.
   - Conciliar "con datos" con las novedades de la ventana.
4. **Etiquetas:** no presentar el vencimiento de un término como "programada".

## Pruebas de regresión propuestas

- **Clasificación**, en `src/test/` o `src/__tests__/`, con los cuatro textos reales como casos fijos:
  - comunicación → sin término;
  - "corre traslado… desistimiento" → sin RESPUESTA_REQUERIMIENTO;
  - "tiene notificado por conducta concluyente" → revisión manual;
  - "mediante sentencia anticipada" → no es SENTENCIA;
  - "ERROR DE INGRESO / Actuación anulada" → sin término.
- **Correo**, ampliando `src/test/source-run-quality-tt.test.ts`: "sin confirmar" igual a `expected - answered`; NEVER_ANSWERED con PENDING_UPSTREAM no afirma la causa del despacho.
- **Base de datos:** prueba de `classify_providencia` en Deno (`_shared/*_test.ts`) que refleje las reglas.

## Capacidad real de despliegue

- Las migraciones pasan por la herramienta de migraciones. Las funciones del backend (`scheduled-daily-digest`) se despliegan directamente.
- La verificación se hace generando una vista previa del correo con fecha futura, sin enviar nada. Los datos se revisan con consultas de solo lectura.
- No hay horarios nuevos, monitores nuevos, llamadas a proveedores ni envíos. No se inicia sesión como ningún usuario.
- La lectura de los PDF de los autos queda a cargo del abogado.
