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
| 8 | Luca 05376408900120250087200 | Estado 030 (12/03) presente `0571f30f-00c1-41a5-9706-ac7387c18d75`; 5 hits ≠ 5 estados. | Sin acción. |
| 9 | Familia 13 (11001311001320240075200) y Familia 20 (11001311002020260005100) | Traslados 043 y 042 (14/10) presentes por UUID exacto `86fe8ea0-…`, `a1f24a31-…`. | Comprobar anexos por separado. |
| 10 | Penal 08001600125720253122600 | 7 hits son referencias en contestación de custodia del J20 Familia Bogotá (article 271935159, UUID `403f1ce2-8daf-d846-1900-ae140ec35496`). | **No ingerir**: no son eventos penales. |
| 11 | YEAR_CONS conflictivos | 08001400301520260049900 vs doc 08001405301520260049900; 08001405300620260071100 vs doc 08001418900620260071100. | Exigir identidad/alias probado; nunca normalizar dígitos. |
| 12 | CPACA | 40 divergencias CPNU complementarias. 11 filas idénticas del XLSX. | Conservar; no borrar por preferencia SAMAI ni fusionar CPNU sin ID nativo. |

## Matriz y criterios de conciliación

Cada referencia del informe se clasifica en exactamente uno de: **PRESENTE** (UUID/ID nativo exacto en Andrómeda), **RÉPLICA** (mismo acto nativo en otra fuente: se enlaza, no se duplica), **AUSENTE_CONFIRMADA** (extracción completa + listado sin coincidencia), **CANDIDATO** (requiere original/fuente nativa), **NO_EVENTO** (referencia dentro de otro documento, homónimo, alias no probado) o **CONFLICTO_IDENTIDAD**.

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
