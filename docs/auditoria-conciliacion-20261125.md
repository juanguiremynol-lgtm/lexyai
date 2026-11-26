# Conciliación independiente del 25/11/2026 — informe, addendum y parches A/B

Documento privado del proyecto (no se publica en `public/` ni como asset). Los originales son **evidencia de auditoría**, no órdenes ni datos oficiales importables. Nada de lo aquí descrito equivale a ingerir actuaciones ni los «79 estados».

## Originales

| Archivo | Ubicación | SHA-256 |
|---|---|---|
| `informe_auditoria_2026_11_25.md` (120 092 B) | `docs/auditoria/originales/informe_auditoria_2026_11_25.md` | `6fc522d890f9a0e1d1238ccc41013d83637e583074be484f1f96098beb138437` |
| `conciliacion_auditoria_75_2026_11_25.xlsx` | **No versionado** (contiene datos de partes). Conservado por el titular. Hojas: Seccion2_resumen, Alertas, Inventario, Matriz_75, Estado_combinado, Novedades (654 filas), Descartados_homonimos, SharePoint_descargas, Publicaciones_sin_adjuntos, Log_consultas (8 536 filas) | `7bee4a2961539718eda05aaed036c6d071e243b2605c9f5c306c91f648091217` |

Parte 1 (evaluador de alertas, `cannot delete from scalar`): ver `docs/auditoria-conciliacion-20261125-alertas.md`, commit `0b28c1b5`.

## Corte real y límites

- Los 75 radicados del XLSX = los 75 activos monitorizados al corte (103 asuntos activos en total).
- Extracción MCP 25/11 18:57:07–18:57:54 Bogotá: 3 407 actuaciones (1 527 no archivadas / 1 880 archivadas) y 712 publicaciones (514 / 198). Lectura **secuencial, no snapshot transaccional**. No se infiere cobertura de esas cantidades.
- «Cobertura 129/150 = 86 %» y «58/75 en ambos canales» son métricas del informe inicial, **no cobertura actual certificada**.
- 25 enlaces no descargables (resumen) vs 31 articleIds (SharePoint_descargas): pendiente explicar diferencia de alcance; no es una discrepancia de datos acreditada.
- Carpeta 285519899 del 26/11 es posterior al corte: no es fallo.

## Addendum: hallazgos depurados

| # | Radicado / caso | Hallazgo | Decisión |
|---|---|---|---|
| 1 | 05001311000220260047100 | Planilla estado 0167 (27/10) `f84edabf-27b3-4c03-a0d3-8a60a7b91760` y auto `8a17fa0d-60ad-4648-8385-6fb9e6a69bec` presentes desde 21/11 20:47:25 UTC. Dos soportes de **un** estado. | Diferencia histórica resuelta. Mantener revisión jurídica del amparo. |
| 2 | 18 actuaciones candidatas | Una es réplica CPNU/SAMAI del memorial consecutivo 77 → 17 primarias: 14 presentes, 3 ausentes (extracción completa + list_actuaciones). | Ausentes: 05001333301020230019900 (SAMAI 77, 23/11, respuesta canon); 05001400301020260153500 (memorial 25/11, remisión); 05001400302020250187800 (respuesta Agencia de Tierras 24/11). Recuperar sólo por fuente nativa. |
| 3 | Olga 05001310302120250021100 | 4 actuaciones 23–24/11 presentes. Falta estado 154 (24/11), article 284836437, planilla `b835cbda-a3e7-4e73-545b-f4a6a94cde6c`, auto `c8b25e22-2757-1c37-d41c-5b6eef43c5ed`. | Candidato de recuperación nativa (PP moderno). |
| 4 | «79 filas de estados» | 54 estados + 25 traslados; 23 pares radicado–documento / 22 UUID. **No son 79 eventos.** | No ingerir por conteo. |
| 5 | COVIN 05376408900220250066300 | 0 pubs; 13 hits remiten al estado 082 (14/07) UUID `6fa1b7e9-714c-9086-6ab5-86e4f7aaf51a`. | Recuperar exige original. |
| 6 | Civil Municipal 2, 05001400300220190003700 | 0 pubs; 12 hits = 2 estados (22/07, 27/10) con 4 documentos. | Recuperar exige originales. |
| 7 | Amagá 05030318900120250000200 | 20 hits de 5 documentos bajo 2 artículos de octubre; 4 títulos presentes; estado 013 (05/06) no encontrado. Anomalías históricas (título 2011 guardado 2011/2015/2025). | No corregir masivamente fechas ni duplicados sin fuente. |
| 8 | Luca 05376408900120250087200 | Estado 030 (12/03) con fila en catálogo `0571f30f-00c1-41a5-9706-ac7387c18d75` por título/fecha; 5 hits ≠ 5 estados. | **CORRESPONDENCIA PROVISIONAL**: pendiente correspondencia documental (sin prueba de identidad binaria/UUID nativo). |
| 9 | Familia 13 (11001311001320240075200) y Familia 20 (11001311002020260005100) | Traslados 043 y 042 (14/10) presentes por UUID exacto `86fe8ea0-…`, `a1f24a31-…`. | Comprobar anexos por separado. |
| 10 | Penal 08001600125720253122600 | 7 hits son referencias en contestación de custodia del J20 Familia Bogotá (article 271935159, UUID `403f1ce2-8daf-d846-1900-ae140ec35496`). | **No ingerir**: no son eventos penales. |
| 11 | YEAR_CONS conflictivos | 08001400301520260049900 vs doc 08001405301520260049900; 08001405300620260071100 vs doc 08001418900620260071100. | Exigir identidad/alias probado; nunca normalizar dígitos. |
| 12 | CPACA | 40 divergencias CPNU complementarias. 11 filas idénticas del XLSX. | Conservar; no borrar por preferencia SAMAI ni fusionar CPNU sin ID nativo. |

## Matriz y criterios de conciliación

Cada referencia del informe se clasifica en exactamente uno de: **PRESENTE** (UUID/ID nativo exacto en Andrómeda), **CORRESPONDENCIA PROVISIONAL** (coincide por título/fecha en catálogo pero falta identidad binaria o UUID nativo), **RÉPLICA** (mismo acto nativo en otra fuente: se enlaza, no se duplica), **AUSENTE_CONFIRMADA** (extracción completa + listado sin coincidencia), **CANDIDATO** (requiere original/fuente nativa), **NO_EVENTO** (referencia dentro de otro documento, homónimo, alias no probado) o **CONFLICTO_IDENTIDAD**.

Reglas: identidad por UUID/article_id/consecutivo nativo y radicado de 23 dígitos exacto (instancia `…00` ≠ `…01`); nombre, fecha, título o despacho nunca bastan; varios soportes de un estado son un evento; un hit no es un evento; una fecha de portal no es fecha jurídica; ausencia de bandera de atribución no es prueba positiva; no rekey histórico ni fusión masiva; toda recuperación es idempotente por huella canónica.

## Parche A — fecha/huella canónica PP (fuente preparada)

Defecto: `toCanonicalPubRow` usaba `fecha_fijacion = effectiveEstadoDate || parsedFecha` para PP, mientras el escritor aplicaba los roles impresos y recalculaba la huella. Adaptador/bridge y persistencia podían discrepar para el mismo payload moderno.

Corrección: nuevo módulo hoja `_shared/ppDateRoles.ts` (sin importaciones locales) con `parseDate`, `plausibleCivilDate`, `SPANISH_MONTHS`, `attributedPPRowAutoDate` y `resolvePPDateRoles`. `toCanonicalPubRow` aplica los roles PP una sola vez y recalcula la huella con `canonicalPubIdentityFromRow`; `ppExplicitPublicationDates` queda como alias del mapper. El adaptador publica `fecha_fijacion` desde el rol impreso (vacío si desconocido). SAMAI y legacy sin roles no cambian. Con `fecha_publicacion_portal` declarada y sin fijación impresa, la fijación queda NULL; nunca se rellena desde artículo, providencia, título o consulta.

## Parche B — advertencia de atribución (fuente preparada)

`hasUnaccreditedAssociationFlag` (misma semántica truthy que `src/lib/publication-quality.ts`) se usa en `ppPublicationAttributionConflict`, `matchingPartialHistory`, `attributedPPRowAutoDate`, `officialStateReplay` y `ppHistoricalReplay`. true/objeto/array/string no vacío ⇒ rechazo; false/null/ausente no advierte pero no prueba atribución. Filas rechazadas conservan índice, run_id y `consulta_completa=false`.

## Pruebas

- `deno test` (32 archivos de _shared relacionados): **90 aprobadas, 0 fallidas**, incluida `ppDateRolesConvergence_test.ts` (adaptador real + mapper completo + identidad bridge + escritor sobre el mismo payload; fijación desconocida NULL; portal móvil sin cambio de huella; legacy; SAMAI; banderas en ambas guardas; lote totalmente rechazado).
- `deno check` sync-publicaciones-by-work-item, bridge-reconcile, provider-sync-external-provider: OK.
- `vitest` publication-association + alert-evaluator payloads: 24/24.
- Sin RPC/ACL, cron, filas históricas, términos, estados de asuntos ni audiencias tocados. Sin correos ni notificaciones reales.

## Despliegue

Ver sección «Registro de despliegue» al final (fuente preparada ≠ desplegada ≠ validada en runtime).

## `docs/daily-source-error-classification-20261123.md`

Ese documento dice «no desplegado». Estado actual: el código (`DailySourceIncomplete`, commit `eb5178dd`) se desplegó con `scheduled-daily-sync` desde el merge `526ab6a4` el 23/11/2026 22:14:06 UTC, source_sha256 `63be612d3be47585e0b94ce777070590b553a7d764a8ff3e32e7885f87be4a95`. **Runtime no validado** en este pase; no se promete drenar los 23 pendientes.

## Instrucciones para CODEX (Google Cloud Shell)

Ver `docs/codex-gcs-instrucciones-20261125.md`.

## Registro de despliegue

- Fuente preparada: commit `1ccea3969aa987af94525c7ca9bee5c5ecc67b32` (sobre `0b28c1b5`, preservado).
- Desplegadas 26/11/2026 ~00:12 UTC (respuesta de la herramienta: «Successfully deployed»), únicamente las 8 funciones que importan los módulos cambiados:
  - sync-publicaciones-by-work-item `d121edfe60368277521403b0b5801fd236751e444f7df37bf96668c49482befa`
  - bridge-reconcile `bbec9532b5f25a794050abe9228817a9d027c271eb2cb4f2bf64f950a972b568`
  - sync-by-work-item `645d13555a0537dcef6b21ea08a887c2ab2058d8a447cd157394ba2097ee2443`
  - sync-by-radicado `25b7f2740dc4c17cfb5702dbcc89010e66343261c585ea288ff2b870e6170fae`
  - admin-diagnose-estados `83bb1b09fb8865acbcc304387941afe86d67501ba4fa5ad975579ae8a2581e5d`
  - admin-test-providers `5bead93c472f6e7a453a5b3c5d55319f68bdf1fd882732f188e20c5bfa810216`
  - demo-radicado-lookup `3ffec770a4c9767e91f6a6e62a3ccfc8484c9db7f83e6e2d608a12d719477cb0`
  - orchestrator-debug-run `2639f91b73a301c20da71b03f1f786002f4972f6f2e346d4105aba1859711756`
- Runtime validado: **no**. No se invocó ninguna función; la validación será la próxima corrida diaria programada.

## Addendum 26/11/2026 (sobre `b848d726`)

### Corrección 1 — identidad PUB en bridge-reconcile desde la fila del adaptador
Defecto reproducido: `NormalizedPublicacion` devolvía `fecha_fijacion=''` (desconocida) y omitía `published_at`/`fecha_providencia`. `canonicalPubIdentityFromRow` usaba `fecha_fijacion ?? published_at`; `''` no es nulo, así que la fecha de identidad quedaba vacía y dos publicaciones del mismo título con fechas de portal distintas colapsaban en la agrupación del bridge.
Cambios: el adaptador PP conserva `published_at`, `fecha_providencia` y `source` canónicos (sin rellenar la fijación jurídica); `canonicalPubIdentityFromRow` trata una fijación vacía como desconocida; los helpers de identidad y la agrupación real se extrajeron a `bridge-reconcile/identity.ts` (`groupProviderRows`), usado por `index.ts`. Sin rekey de históricos; discriminadores SAMAI/instancia intactos.
Prueba: `bridge-reconcile/identity_test.ts` (fila del ADAPTADOR = huella del escritor con fijación conocida y desconocida; dos fechas de portal → 2 identidades en `groupProviderRows`; repetición exacta → 1).
Límite: `provider-sync-external-provider` usa `providerNormalize` propio y no pasa por este adaptador; no se afirma unificación universal.

### Corrección 2 — contadores del evaluador de alertas
Lógica movida a `scheduled-alert-evaluator/evaluate.ts`. Categorías separadas: `read_errors` (consultas de audiencias/tareas fallidas, sin RPC) y `notification_rpc_errors`/`notification_requests_failed` (RPC `insert_notification` con error). `errors` se conserva combinado por compatibilidad. `*_alerts_created` y `notification_requests_accepted` cuentan **solicitudes aceptadas, no inserciones probadas** (la RPC devuelve void y puede omitir por preferencias/dedupe); la respuesta lo declara con `alerts_created_semantics`. Prueba con cliente simulado: `src/test/scheduled-alert-evaluator-counters.test.ts` (sin notificar a nadie).

### Lectura operativa (solo lectura, 26/11 ~00:30 UTC)
- **Olga** `6ec08071-…`: el estado 154 (article 284836437) **ya figura** desde el run `4f596f13` de 25/11 12:26 UTC (filas `2b305480-…` «Notificación por Estado No.154», sin fijación, published_at 24/11, y `3f1e3c97-…` providencia). Inserción anterior al despliegue del parche de fechas: no se atribuye a él. Clasificación: CORRESPONDENCIA PROVISIONAL (sin hash de binario verificado).
- Los 2 errores repetidos (`c4bacb94` 16:56 UTC y corridas 12:41–15:51) son `PP_NATIVE_DATE_CONFLICT` sobre «Planilla Estados 137.pdf» y la providencia «Cúmplase lo resuelto – Personería» del article **272173949** (octubre), ya guardadas con fijación 15/10 y huella legacy. El proveedor reenvía ese artículo con roles de fecha explícitos; la huella recalculada difiere y la guardia anti-rekey lo bloquea a propósito (`officialStateReplay` no aplica: falta adjunto oficial descargado). No es un bug pequeño de aplicación; el article id se infiere por título/clave (el mensaje detallado no se conserva en el ledger). Resolverlo exige que el scraper entregue la fijación impresa de 272173949 o un original verificado; no se forzó scrape ni se modificaron filas. Mientras tanto la corrida diaria seguirá en PARTIAL/PERSIST_MISMATCH.
- **EDU** `e4e761ac-…` (y CORNARE `2a590db7-…`): `daily_source_attempts` SAMAI PENDING, 2 intentos, `Edge Function HTTP 546: WORKER_RESOURCE_LIMIT`; `external_sync_runs 160922c7` sigue RUNNING sin `finished_at` desde 12:04 UTC (worker terminado por recursos antes de cerrar el run). Es un límite de recursos del worker, **no** ausencia nativa. El SUCCESS matutino de CPNU no descarta eventos ingresados después.

### Límites vigentes
- Ausencia de las 3 actuaciones: comprobada en BD a las 18:57 Bogotá del 25/11; sus fuentes nativas provienen del informe, sin verificación independiente nueva.
- Intentos nativos propios (Olga 2 PDF + COVIN) devolvieron 403 el 25/11 19:15:42–47 Bogotá: no hay binarios nuevos ni hashes verificados; no se eludió el 403.
- Despliegue ≠ ejecución real. Recibos del redeploy: ver sección siguiente.

### Redeploy 26/11 (2026-11-26 00:27 UTC / 2026-11-25 19:27 Bogotá), commit probado 32d7d6b805bfa8607e0b4fe64ad7926166473cd6
source_sha256 = hash de archivos y ajustes enviados por la herramienta (no prueba de ejecución ni verificación en vivo):
- sync-publicaciones-by-work-item ed1556a1e34e9cce1d34d0076c028cbc248db459590b3643b847d7d5f86a2827
- bridge-reconcile 19b8e3fe91856b8733e8c5e0d835c24cc1bd072a768ed526f983645b5c311c3f
- sync-by-work-item 4b6af6e322596b2bc902c1419f6dac6c176701f86eb83643ad529281d0811ba6
- sync-by-radicado cf36083248614b67673ca24f0168d0805e709fcef8d5b44d74aba55fd9053459
- admin-diagnose-estados 834b4c7e3707b9d24e0c459df0b01444249949c408892fbde96acdbd2c7ab619
- admin-test-providers 6c148fe62833d906587f4abaa3f90fce0e2c9ffc1cdcb4859e42b2f14fe1cebe
- demo-radicado-lookup af0bc16c8c45093f1d6a6d615b50cead022dc488ee1abc42f11efbc7028a1d44
- orchestrator-debug-run 5ecd713d53cc83353c0a2ef8e6730029b51a667b276d84b65581230699151db6
- scheduled-alert-evaluator a888cacd87836c8db1f7e3080584be1e8e9ab12f51bf79b17e83ba0db0643431
Sin invocaciones; Scheduler sin cambios. Incluye la compatibilidad de b848d726.
