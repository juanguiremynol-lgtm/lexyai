

## Plan: Fallback ANDROMEDA en `AlertConsolidatedRow` para enriquecer datos faltantes

### Objetivo
Cuando `payload.despacho` o `payload.demandante` están vacíos, hacer fetch a `GET ${ANDROMEDA_API_BASE}/radicados/:radicado` y usar la respuesta como fallback. Cachear por radicado con React Query.

### Cambio 1 — Nuevo hook `src/hooks/useAndromedaRadicado.ts`

```ts
import { useQuery } from "@tanstack/react-query";
import { ANDROMEDA_API_BASE } from "@/lib/api-urls";

export interface AndromedaRadicadoData {
  despacho_nombre?: string | null;
  demandante?: string | null;
  demandado?: string | null;
}

export function useAndromedaRadicado(radicado: string | null, enabled: boolean) {
  return useQuery<AndromedaRadicadoData | null>({
    queryKey: ["andromeda-radicado", radicado],
    enabled: enabled && !!radicado,
    staleTime: 1000 * 60 * 60, // 1h
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    queryFn: async () => {
      if (!radicado) return null;
      const res = await fetch(`${ANDROMEDA_API_BASE}/radicados/${encodeURIComponent(radicado)}`);
      if (!res.ok) return null;
      return (await res.json()) as AndromedaRadicadoData;
    },
  });
}
```

### Cambio 2 — `src/components/alerts/AlertConsolidatedRow.tsx`

**a. Helper para extraer radicado** (23 dígitos, formato Colombia):
```ts
function extractRadicado(alert: AlertLike, payloadRadicado: string | null): string | null {
  if (payloadRadicado) return payloadRadicado;
  const RX = /\b\d{23}\b/;
  return alert.title?.match(RX)?.[0] ?? alert.message?.match(RX)?.[0] ?? null;
}
```

**b. Detectar si falta data y disparar query**:
```ts
const radicadoForLookup = extractRadicado(alert, radicado);
const needsFallback = !despacho || !demandante || !demandado;
const { data: andro } = useAndromedaRadicado(radicadoForLookup, needsFallback);

const finalDespacho   = despacho   ?? andro?.despacho_nombre ?? null;
const finalDemandante = demandante ?? andro?.demandante      ?? null;
const finalDemandado  = demandado  ?? andro?.demandado       ?? null;
const finalRadicado   = radicado   ?? radicadoForLookup;
```

**c. Render**: reemplazar `radicado` → `finalRadicado`, `despacho` → `finalDespacho`, `demandante`/`demandado` → versiones finales. Sin cambios visuales adicionales — los mismos bloques se muestran si los valores existen, ahora poblados desde ANDROMEDA cuando el payload no los tiene.

### Detalles técnicos
- **Caché por radicado**: dos alertas del mismo expediente comparten un único request.
- **No bloquea render**: la fila se pinta de inmediato con lo del payload; cuando llega ANDROMEDA, React Query refresca y los `—` se reemplazan.
- **Tolerancia a fallos**: `res.ok` falso → `null`, fila queda como antes (con `—`). `retry: 1` evita ruido.
- **No se llama si no hace falta**: `enabled` solo se activa cuando algún campo está vacío Y hay radicado disponible.
- **Sin auth**: el endpoint es público (mismo patrón que otros usos de `ANDROMEDA_API_BASE` en el código). Si requiere headers, se ajustará al detectar 401.

### Fuera de alcance
- No se modifica `Alerts.tsx` ni `NotificationsAlertTab.tsx`.
- No se backfillea la base — el fallback es lazy en cliente.
- No se cambia `isProcedural` ni el sistema de portal badges.
- No se persiste el resultado de ANDROMEDA en `alert_instances.payload` (sería un siguiente paso si se quiere reducir requests cross-sesión).

