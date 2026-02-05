
# Plan: TUTELA Multi-Provider Parallel Sync — IMPLEMENTED ✅

## Estado: Completado (2026-02-05)

### Cambios Realizados

#### 1. `sync-by-work-item` — Parallel TUTELA Sync ✅
- TUTELA workflow ahora lanza CPNU + SAMAI + TUTELAS API en paralelo vía `Promise.allSettled`
- Los resultados se fusionan (metadata del provider más completo + campos faltantes de los demás)
- Las actuaciones se deduplican por clave de similitud (fecha + prefijo de descripción 60 chars)
- Se elige la versión "más rica" (más metadata) para registros duplicados
- Se mantiene la fuente compuesta (`cpnu+samai+tutelas-api`) en `provider_used`
- Si ningún provider tiene datos pero se inició scraping → retorna HTTP 202

#### 2. `sync-by-radicado` — Parallel TUTELA Lookup (Wizard) ✅
- TUTELA lookup ahora consulta CPNU, SAMAI y TUTELAS en paralelo
- Fusión inteligente: provider con más metadata gana como base, campos faltantes se completan
- Actuaciones deduplicadas por fecha + prefijo de descripción
- `sources_checked` ahora incluye los 3 providers
- `source_used` muestra las fuentes que encontraron datos (ej: `CPNU+TUTELAS`)

#### 3. Publicaciones para TUTELA ✅
- TUTELA ahora incluido en la lista de workflows que triggean `sync-publicaciones-by-work-item`
  al crear un work_item nuevo

#### 4. Frontend `LookupResult` type ✅
- Agregado `sources_found?: string[]` al tipo

### Matriz de Providers por Workflow (ACTUALIZADA)

| Workflow | Estrategia | Providers | Notas |
|----------|-----------|-----------|-------|
| CGP | Sequential | CPNU only | Sin fallback |
| LABORAL | Sequential | CPNU only | Sin fallback |
| CPACA | Sequential | SAMAI primary | CPNU fallback deshabilitado |
| **TUTELA** | **Parallel** | **CPNU + SAMAI + TUTELAS** | **Merge + dedup** |
| PENAL_906 | Sequential | CPNU primary, SAMAI fallback | + Publicaciones separado |
