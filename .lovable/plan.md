# Auditoría secundaria — remediación

Verifiqué en la base de datos los tres puntos comprobables antes de planear: la vista de asuntos monitoreados es de propietario `postgres`, sin `security_invoker`, con permisos de lectura y escritura para el rol anónimo; la función que genera alertas de buzón es `SECURITY DEFINER` y ejecutable por cualquiera; y esa vista no la consulta ninguna pantalla de la aplicación (solo la usan procesos internos), así que puede cerrarse por completo al cliente.

## Bloque 1 — Contención de seguridad (primero, todo junto)

**1. Vista de asuntos monitoreados.** Quitar todo acceso de los roles público/anónimo/autenticado y dejarla solo para los procesos internos. Además activar `security_invoker` y `security_barrier` para que, si algún día se vuelve a abrir, aplique los permisos de quien consulta. Ninguna pantalla se ve afectada: hoy nadie la lee desde el navegador.

**2. Funciones privilegiadas sin control de llamador.** `scheduled-daily-digest`, `process-email-outbox`, `outlook-token-refresh` y `digest-failure-watchdog` crean un cliente con permisos totales sin verificar quién llama. Se añade una comprobación única y compartida, ejecutada **antes** de cualquier lectura, escritura o toma de turno: se acepta la llave dedicada de tareas programadas (`x-cron-key`, ya existente en `_shared/cronAuth.ts`), o un token de servicio; cualquier otra cosa se rechaza con 401 sin dejar rastro ni efecto. Se extiende el mismo control al resto de funciones equivalentes que hoy quedan abiertas.

**3. Función de alertas de buzón.** Revocar la ejecución a los roles anónimo y autenticado; dejarla solo para el proceso interno. Se hace lo mismo con las funciones de cobertura (`source_coverage_exceptions`, `source_coverage_persistence`) y con la de generación de borradores de WhatsApp, que hoy están igualmente abiertas.

**4. Fuga entre despachos en el correo diario.** Hoy las excepciones de cobertura y la persistencia se calculan una sola vez, globalmente, y se pasan íntegras a cada destinatario. Se filtrarán por los asuntos autorizados de cada destinatario **antes** de renderizar. Las estadísticas agregadas de salud de proveedor pueden seguir siendo globales; los radicados, títulos e identificadores no.
Prueba de aceptación: un escenario con dos despachos sintéticos donde ningún dato del despacho B aparece en el correo de A.

## Bloque 2 — Defectos funcionales

**5. Enlaces rotos en los correos.** El correo genera `/app/work-item/<id>` y la aplicación registra `/app/work-items/:id`. Se añade una redirección permanente de la forma antigua (los 29 correos ya enviados vuelven a funcionar) y un constructor de enlaces compartido para los nuevos.

**6. Términos en revisión manual invisibles.** El filtro del asistente busca `PENDING_REVIEW` y los 26 registros actuales usan `REQUIERE_REVISION_MANUAL`. Se centraliza la taxonomía de estados y se mapean ambos. Se añade la atribución del término (cliente, contraparte o `DESCONOCIDO`) a la respuesta, para que la incertidumbre sea visible. No se convierte ningún registro incierto en obligación vigente.

**7. Un término vencido aparece como "vence hoy" el fin de semana.** La urgencia se decide hoy solo por la cuenta de días hábiles, que da cero negativo. Se decidirá comparando la fecha almacenada con la de hoy; la cuenta de días hábiles queda solo para el conteo.

**8. Avisos de WhatsApp.** Se añade una toma atómica del borrador antes del envío externo (nadie puede enviarlo dos veces), se protege la transición de aprobación con un disparador que impide cambiar aprobador y consentimiento después del hecho, y se verifica que consentimiento, cliente y organización correspondan al borrador. Se comprueba el guardado tras la llamada al proveedor.

**9. "Todas las fuentes completas" cuando la consulta falló.** Una colección vacía de diagnósticos se está leyendo como éxito. Cada fuente esperada quedará representada explícitamente, incluido el resultado `CHECK_FAILED`, y el titular de cobertura completa exigirá resultados afirmativos.

**10. Contabilidad de envío antes de la entrega.** Se separan los estados de cola y de entrega, se enlaza el registro de eventos con la operación de salida, y el vigilante reconciliará el caso de corrida marcada enviada con salida fallida en firme. Se añade clave de idempotencia al proveedor de correo.

**11. Tope de 400 filas que descarta eventos.** La ventana avanza aunque el tope haya dejado registros fuera. Se paginará la ventana elegible y el límite de la ventana no podrá avanzar por encima de registros no procesados. Además, `hasContent` incluirá audiencias posteriores, términos sin verificar y asuntos pausados, hoy omitidos.

**12. Asuntos borrados que aún aportan filas.** La consulta de actuaciones del día filtra el asunto padre solo al enriquecer. Se aplicará la elegibilidad del padre antes de contar, paginar y responder. No se borra ninguno de los 535 registros históricos.

## Bloque 3 — Endurecimiento del asistente

**13.** La herramienta genérica de consulta valida la tabla pero pasa las columnas tal cual, lo que permite traer relaciones no aprobadas. Se validarán columnas y relaciones permitidas y se rechazará lo demás.

**14.** Las notas concurrentes se pisan: se cambiará a una adición atómica en base de datos. Y el recorte de textos largos parte el JSON por la mitad: se limitará por número de registros antes de serializar.

**15.** La facturación simulada no debe poder activarse en producción: fallará cerrada cuando falte el proveedor, y una verificación fallida no activará ninguna suscripción.

## Fuera de alcance / no tocado

- No se pausan, reclasifican ni recalculan asuntos ni términos.
- No se cambia enrutamiento de proveedores ni se afirma causa de los dos radicados con lecturas faltantes.
- No se publica la aplicación hasta su confirmación.

## Detalle técnico

- Migraciones: `REVOKE` sobre la vista + `security_invoker=on, security_barrier=on`; `REVOKE EXECUTE ... FROM anon, authenticated` en las cuatro funciones; disparador de inmutabilidad de aprobación y RPC de toma atómica (`client_wa_claim_draft`) para WhatsApp; RPC de adición atómica de notas.
- Nuevo `supabase/functions/_shared/privilegedCaller.ts`: única puerta de entrada (`requirePrivilegedCaller(req)`) usada antes de instanciar el cliente de servicio.
- `scheduled-daily-digest`: filtrado por destinatario de `coverageExceptions`/`coveragePersistence`, resultados `CHECK_FAILED` explícitos, paginación de la ventana y cursor que no avanza sobre lo no procesado.
- `src/lib/mcp/`: taxonomía de estados compartida, atribución en `list-deadlines`, urgencia por fecha, allowlist de columnas en `query-table`, truncado por registros en `shared.ts`.
- Pruebas: dos despachos sintéticos, llamada anónima rechazada sin efectos, concurrencia de borrador y de nota, ventana de 401 registros, fallo de la consulta de cobertura, fin de semana con término vencido.
