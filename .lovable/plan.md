

## Plan: Corregir badge "Sistema" → "SAMAI Estados"

### Causa raíz
El mapa de badges en `EstadosTab.tsx` (línea 87) solo reconoce `SAMAI_ESTADOS` (mayúsculas), pero el fix de persistencia escribe `source = 'samai_estados'` (minúsculas). Al no encontrar match, usa el fallback `DEFAULT` → badge "Sistema".

### Cambio

**Archivo**: `src/pages/WorkItemDetail/tabs/EstadosTab.tsx`

Agregar la variante en minúsculas al mapa `SOURCE_BADGES` (~línea 87):

```typescript
SAMAI_ESTADOS: { label: "SAMAI Estados", color: "text-blue-600 bg-blue-500/10", icon: Scale },
samai_estados: { label: "SAMAI Estados", color: "text-blue-600 bg-blue-500/10", icon: Scale },
DEFAULT: { label: "Sistema", color: "text-muted-foreground bg-muted/50", icon: Newspaper },
```

Un cambio de 1 línea. Sin impacto en otras funcionalidades.

