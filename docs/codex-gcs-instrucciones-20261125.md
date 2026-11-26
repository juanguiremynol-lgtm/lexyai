# Instrucciones para CODEX — scrapers en Google Cloud Shell (25/11/2026)

Los scrapers viven en Google Cloud Shell; no se reubican en Andrómeda. Andrómeda consume sus contratos. Esta guía define lo que el lado GCS debe entregar.

## 1. Contrato moderno PP (por publicación)
- `estado.article_id` (string numérico nativo), `estado.numero`, `estado.tipo_publicacion` (Estado Electrónico / Traslado).
- `estado.fecha_publicacion_portal` **siempre presente como clave** (null si no se conoce). Es fecha de portal, no jurídica.
- `estado.fecha_fijacion_impresa`: sólo si se lee impresa en la planilla; si no, omitir o null. Nunca copiar portal, artículo, providencia, título ni fecha de consulta.
- `fecha_providencia_impresa`: sólo impresa en el auto.
- `documentos_pdf[]` con `tipo` (estado/auto/traslado/escrito), `pdf_url`, y originales con SHA-256.
- `documento_atribucion`: `radicado` de 23 dígitos exacto (instancia `…00`/`…01` distinta), `paginas_fuente` o `paquete.paginas_caso`, `asociacion_no_acreditada` (cualquier valor truthy = advertencia; Andrómeda rechaza la fila).

## 2. Publicación vs documento vs evento
Un evento = un (article_id, tipo_publicacion). Planilla y auto son **soportes** del mismo estado. Un hit en un PDF ajeno (p. ej. referencias citadas) no es evento. Paquetes de centros de servicios: sólo las páginas del caso.

## 3. Backfill idempotente
- Sólo casos explícitos (Olga estado 154 art. 284836437; COVIN estado 082; Civil Mpal 2 estados 22/07 y 27/10; 3 actuaciones ausentes listadas en `docs/auditoria-conciliacion-20261125.md`).
- Reenviar por el contrato normal; Andrómeda deduplica por huella canónica. No crear claves nuevas para reintentos; nunca re-POST de un run incierto (seguir GET /runs/{id}).
- Respetar una actualización lógica por usuario+asunto por día Bogotá; nada de cron ni sondeo nuevo.

## 4. Atribución
Sin radicado de 23 dígitos exacto ⇒ marcar `asociacion_no_acreditada` con motivo. Alias YEAR_CONS (p. ej. 08001400301520260049900 vs 08001405301520260049900) sólo con prueba documental.

## 5. Calendario
Los términos los calcula Andrómeda (`business_days_between_sql`, calendario judicial). GCS no calcula términos ni vencimientos.

## 6. Criterios de aceptación
1. Mismo payload ⇒ misma `fecha_fijacion`, `published_at`, `fecha_providencia` y `hash_fingerprint` en adaptador, bridge y escritor (ya garantizado del lado Andrómeda).
2. Fijación desconocida llega null y se persiste null.
3. Filas con advertencia aparecen como rechazadas con índice y run_id; un lote totalmente rechazado no acredita consulta completa.
4. Reejecución del backfill no crea filas nuevas.
5. Evidencia: run_id, article_id, SHA-256 de originales, conteo aceptadas/rechazadas.

## Addendum 26/11/2026
- Olga article 272173949 (estado 137, 15/10): el payload moderno reenvía el artículo con roles de fecha que cambian la huella respecto a la fila guardada → `PP_NATIVE_DATE_CONFLICT` diario. Entregar `estado.fecha_fijacion_impresa` leída del original, o el PDF oficial con URL+SHA para `recuperacion_oficial`. No re-POST ni rekey.
- Estado 154 (article 284836437) ya está en Andrómeda sin fijación impresa ni hash de binario verificado: CORRESPONDENCIA PROVISIONAL hasta aportar original.
- Catálogo PRESENTE por título/fecha (Luca, Amagá) = CORRESPONDENCIA PROVISIONAL, no prueba UUID.
- Los 403 nativos del 25/11 19:15 Bogotá (Olga 2 PDF, COVIN) no se eluden; sin binarios ni hashes nuevos.
- SAMAI EDU/CORNARE: `WORKER_RESOURCE_LIMIT` (HTTP 546) es recurso del worker, no ausencia nativa.
- `provider-sync-external-provider` usa `providerNormalize` propio: no asumir la misma identidad PUB que el adaptador PP.
