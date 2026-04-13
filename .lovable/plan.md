

## Plan: Corregir `source` hardcodeado y re-sincronizar CPACA

### Problema
En líneas 1004 y 1018 del edge function, `source` y `sources` están hardcodeados como `'publicaciones'`, ignorando el `_source_provider: 'samai_estados'` que se asigna a los estados SAMAI en línea 761.

### Cambios

**Archivo**: `supabase/functions/sync-publicaciones-by-work-item/index.ts`

1. **Línea 1004** — Usar `_source_provider` si existe:
   ```typescript
   source: (pub as any)._source_provider || 'publicaciones',
   ```

2. **Línea 1018** — Mismo cambio para el array `sources`:
   ```typescript
   sources: [(pub as any)._source_provider || 'publicaciones'],
   ```

### Después del cambio
1. Desplegar el edge function
2. Re-ejecutar `sync-publicaciones-by-work-item` para los 9 work items CPACA
3. Verificar con query SQL que los registros SAMAI ahora tienen `source = 'samai_estados'`

### Work items a sincronizar

| work_item_id | radicado |
|---|---|
| 2a590db7-0330-4b8d-9403-5963e4bd15a1 | 05001233300020240115300 |
| 154b4c7d-78e9-4dc2-8989-1b70a5349aec | 05001333300320190025200 |
| 12a4445a-c31f-41e7-9a3c-82f8a47b1f9a | 05001333301820200006500 |
| 530e0e88-81be-4927-bcbe-ebbcbdbe674a | 05001333300520250001900 |
| e4e761ac-9984-462d-ae6e-a25b244f79ea | 05001333301020230019900 |
| c179889b-c3c1-42fb-afc2-d7cc4eea1d84 | 05001333303320240007800 |
| 057f6932-7f33-4b6e-9379-90d2625897b8 | 05001333300320250013300 |
| caf1442f-188a-45c1-8e89-8ecd43d8c51a | 05001333301020240013900 |
| 6f8ad1de-8355-423f-817e-0f51b0460ca5 | 11001333704320260004700 |

