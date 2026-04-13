

## Plan: Corregir extracción de datos SAMAI Estados para CPACA

### Problema
El bloque CPACA ya existe en `sync-publicaciones-by-work-item` (líneas 689-795), pero tiene un **bug crítico**: en la línea 730 busca `resultado.estados`, mientras que la API real devuelve `resultado.actuaciones`.

```
// Código actual (línea 730) — INCORRECTO:
const rawEstados = Array.isArray(resultado?.estados) ? resultado.estados : [];

// La API devuelve:
{ "total_actuaciones": 6, "actuaciones": [...] }
```

Esto causa que `rawEstados` siempre sea `[]`, y nunca se ingresan estados de SAMAI.

### Cambio necesario

**Archivo**: `supabase/functions/sync-publicaciones-by-work-item/index.ts`

**Línea 730** — Cambiar la extracción para buscar tanto `estados` como `actuaciones`:

```typescript
const rawEstados = Array.isArray(resultado?.estados)
  ? resultado.estados
  : Array.isArray(resultado?.actuaciones)
    ? resultado.actuaciones
    : [];
```

También agregar el campo `hash_documento` del response al mapeo (línea 739), para preservarlo en `raw_data` o en el fingerprint. El mapeo de campos existente (líneas 736-739) ya maneja correctamente:
- `"Fecha Providencia"` → `fecha`
- `"Actuación"` → `actuacion`  
- `"url_descarga"` → `docUrl`

Adicionalmente, se debe incluir `"Docum. a notif."` como parte de la anotación/descripción si está presente.

### Cambios específicos

1. **Línea 730**: Agregar fallback a `resultado.actuaciones`
2. **Línea 738**: Incluir `e['Docum. a notif.']` como fuente de anotación
3. **Línea 749**: Incluir `hash_documento` en el asset_id para mejor deduplicación

### Resultado
Un solo cambio de ~5 líneas que desbloquea la ingesta de estados SAMAI para todos los work items CPACA, sin afectar otros workflows.

