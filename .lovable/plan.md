

## Plan: Actualizar SAMAI_ESTADOS_BASE_URL y sincronizar 9 work items CPACA

### Problema
El secret `SAMAI_ESTADOS_BASE_URL` apunta a `samai-estados-api-486431576619.us-central1.run.app`, que devuelve 404 para todos los endpoints (`/snapshot`, `/buscar`). La URL correcta es `samai-read-api-486431576619.us-central1.run.app`.

### Pasos

1. **Actualizar el secret** `SAMAI_ESTADOS_BASE_URL` a `https://samai-read-api-486431576619.us-central1.run.app` usando la herramienta `update_secret`.

2. **Ejecutar `sync-publicaciones-by-work-item`** en lote para los 9 work items CPACA (usando `curl_edge_functions` secuencialmente):

| # | work_item_id | radicado |
|---|---|---|
| 1 | 2a590db7-0330-4b8d-9403-5963e4bd15a1 | 05001233300020240115300 |
| 2 | 154b4c7d-78e9-4dc2-8989-1b70a5349aec | 05001333300320190025200 |
| 3 | 12a4445a-c31f-41e7-9a3c-82f8a47b1f9a | 05001333301820200006500 |
| 4 | 530e0e88-81be-4927-bcbe-ebbcbdbe674a | 05001333300520250001900 |
| 5 | e4e761ac-9984-462d-ae6e-a25b244f79ea | 05001333301020230019900 |
| 6 | c179889b-c3c1-42fb-afc2-d7cc4eea1d84 | 05001333303320240007800 |
| 7 | 057f6932-7f33-4b6e-9379-90d2625897b8 | 05001333300320250013300 |
| 8 | caf1442f-188a-45c1-8e89-8ecd43d8c51a | 05001333301020240013900 |
| 9 | 6f8ad1de-8355-423f-817e-0f51b0460ca5 | 11001333704320260004700 |

3. **Verificar resultados**: revisar logs y contar cuántos estados se ingresaron en `work_item_publicaciones` con `_source_provider = 'samai_estados'` por cada work item.

### Sin cambios de código
No se modifica ningún archivo — solo se actualiza un secret y se ejecutan llamadas al edge function existente.

