# Informe de solo lectura — anexos SAMAI y cautelares

Commit inspeccionado: `d4a6bd51e23159b9dff5856d5ad206db3b1ac946`. No se modificó código, datos, configuración, secretos ni funciones; no se publicó. El parche de 18 archivos (base 829664db) no está aquí y no se evaluó.

## 1) Estados de anexos/PDF — hallazgos priorizados

**P1. La tarjeta de actuación no tiene estados.** `src/pages/WorkItemDetail/tabs/WorkItemActCard.tsx` (fila 6, `samaiAttachments` de `raw_data.anexos_documentos`) muestra "Documentos adjuntos (N)" y botones Ver/Descargar con cualquier `urlVer`/`urlDescarga` no vacía (enlaces del tribunal, sin comprobar). No distingue anunciado / descriptor sin enlace / enlace / cabecera comprobada / descargado completo. Un descriptor sin enlace aparece igual que uno utilizable salvo por la falta de botón. Además, la línea ~355 muestra "Anexos: N" (número anunciado) en otro sitio sin decir que solo está anunciado.

**P1. Lenguaje que exagera.** `src/lib/act-attachments-inventory.ts` `buildAttachmentInventory`: los textos de causa dicen "PDF verificado" / "Disponibles X de Y" cuando solo se comprobó la cabecera `%PDF-` (`verifyPdfBytes`, 1024 bytes). El estado `disponible` no significa archivo completo. La descripción de la herramienta MCP (`src/lib/mcp/tools/list-act-attachments.ts`) ya aclara "header check only", pero las instrucciones del servidor (`src/lib/mcp/index.ts:52` y su copia empaquetada `supabase/functions/mcp/index.ts:2381`) dicen "enlaces solo de copias propias con PDF verificado". Contradice esa aclaración.

**P2. Copia empaquetada de MCP.** `supabase/functions/mcp/index.ts` es un empaquetado aparte (`list_act_attachments_default`, ~1241/1326). Hay que confirmar que se regenera desde `src/lib/mcp`, porque si no las correcciones de texto no llegan a lo desplegado.

**P2. Escala de 5 niveles incompleta.** El inventario distingue `anunciados`, enlaces propios (`enlaces_sin_verificar`), cabecera (`verificacion: "pdf"`) y origen no permitido. Faltan dos niveles: "descriptor sin enlace" como conteo propio y "descargado completo" (tamaño/hash). `src/lib/act-documentos.ts` usa `DESCARGADO` → "Disponible", con lo que el estado de materialización se iguala a "disponible" sin prueba de integridad.

Cambios mínimos recomendados:
- Renombrar el texto a "cabecera PDF comprobada (no integridad completa)" en la causa y en las instrucciones MCP (src y empaquetado).
- Añadir en el inventario `descriptores_sin_enlace` y un nivel `integridad: "no_comprobada" | "completa"` (completa solo con tamaño/hash).
- En `WorkItemActCard`, mostrar etiquetas por documento (Anunciado / Sin enlace / Enlace del tribunal sin comprobar / Copia propia, cabecera comprobada) y no mostrar "Descargar" como si fuera una copia verificada.

Pruebas propuestas: un descriptor sin URL da `sin_enlace` y nunca `disponible`; un archivo con cabecera válida pero truncado da cabecera comprobada e integridad no comprobada; un test que impida la cadena "PDF verificado" en las salidas de causa y de instrucciones.

## 2) Cautelares — hallazgos priorizados

**P1. El productor del título erróneo no está en el código ni en la base actual.** La alerta `3b5d9a80` tiene el título "Medida cautelar ordenada" y el tipo `ACTUACION_CRITICA`. Ninguna cadena del repositorio ni ninguna función SQL pública contiene "cautelar ordenada". Probablemente salió de un productor ya eliminado o renombrado, o de otro servicio. No hay forma de demostrar desde aquí que ya no se produce. Recomendación: búsqueda de solo lectura en `alert_instances` por título/tipo para saber cuántas filas históricas hay (pendiente, no hecha).

**P1. El productor vigente sigue sin distinguir.** `supabase/functions/sync-by-work-item/index.ts:635` (`detectSignificantEvent`) cubre "medida cautelar", "embargo" y "secuestro de bienes" con título neutro: "Actuación relacionada con medida cautelar". El título es neutro y correcto, pero "Auto que da traslado de medida cautelar" y "decreta medida cautelar" reciben el mismo tipo `MEDIDA_CAUTELAR` y la misma severidad WARNING. Ninguna regla distingue el traslado del decreto.

**P2. Otras rutas.** `src/lib/workflows/estado-stage-inference.ts:529` solo reconoce "niega". La migración `20251227004415` (patrón `(?i)(embargo|secuestro|medida\s+cautelar)`) y `20260714234749` (`AUTO_NIEGA_MEDIDA_CAUTELAR`) siguen agrupando por texto. Hay que comprobar que ningún renderizador (centro de alertas, resumen por correo) reescriba el tipo a "decretada".

Conclusión: el título neutro cubre al productor en la sincronización, pero quedan pendientes los históricos (3b5d9a80 y posibles hermanos) y la falta de una distinción positiva traslado/decreto en las reglas SQL y en la inferencia de etapa.

Cambio mínimo: añadir antes de la regla genérica una regla de "traslado de medida cautelar", con título "Traslado de solicitud de medida cautelar" y severidad INFO. La regla de decreto solo debe activarse con verbos de decisión (decreta/ordena/practica). Prueba: el texto exacto "Auto que da traslado de medida cautelar" nunca debe producir "decretada/ordenada".

## 3) Esquema leído de PRODUCCIÓN (consulta de solo lectura; no son archivos de migración)

- `idx_acts_dedupe_structural`: único sobre (work_item_id, canon_normalize_title(canon_strip_title_noise(description)), act_date, canon_extract_party(NULL, raw_data->>'parte'), COALESCE(recurso_consecutivo,'00')) WHERE is_archived=false. Por eso dos solicitudes del mismo día y título colisionan.
- `idx_work_item_acts_unique`: único sobre (work_item_id, hash_fingerprint) WHERE is_archived=false.
- `rpc_upsert_work_item_acts`: existe; el md5 de su definición es `17cb4c39…`. No se volcó el cuerpo.
- Disparadores al insertar en `work_item_acts`:
  - Antes de insertar: `trg_actuacion_notifiable`, `trg_flag_future_dated_act`, `trg_reject_estados_family_in_work_item_acts`, `trg_stamp_act_canonical`, `trg_stamp_act_discovery`, `trg_stamp_act_workflow_type`.
  - Después de insertar: `trg_notify_new_actuacion` (novedad/notificación), `trg_compute_deadline_on_act` (términos; también al actualizar raw_data/description/act_date/is_archived), `trg_work_item_acts_hearing` (sugerencia de audiencia), `trg_update_actuaciones_count`.
  - Protección: `guard_sync_acts_append_only`, `protect_work_item_acts_delete`, `protect_core_fields_acts`, `trg_freeze_detected_at_acts`.
- Efecto: cada solicitud omitida que se inserte (por ejemplo, tras cambiar el índice estructural) disparará una novedad, el cálculo de términos y una posible sugerencia de audiencia. Al reparar el texto (UPDATE de description/raw_data) se recalculan los términos.

## Pendiente (requiere aprobación; no ejecutado)
- Consulta de solo lectura del número de alertas históricas "Medida cautelar ordenada" y volcado del cuerpo de `rpc_upsert_work_item_acts`, si el relevo lo necesita.
