# Actualización de URLs de APIs al nuevo dominio Cloud Run

Reemplazar el host del proyecto GCP por el nuevo identificador `zcrd2ua7xq-uc.a.run.app` en todos los archivos donde aparece hardcodeado.

## Archivos a modificar

**Cliente (frontend)**
- `src/lib/api-urls.ts` — actualizar las 4 constantes:
  - `CPNU_API_BASE` → `https://cpnu-read-api-zcrd2ua7xq-uc.a.run.app`
  - `PP_API_BASE` → `https://pp-read-api-zcrd2ua7xq-uc.a.run.app`
  - `SAMAI_API_BASE` → `https://samai-read-api-zcrd2ua7xq-uc.a.run.app`
  - `ANDROMEDA_API_BASE` → `https://andromeda-read-api-zcrd2ua7xq-uc.a.run.app`
- `src/hooks/use-work-item-detail.ts` (línea 16) — tiene URL CPNU hardcodeada del proyecto viejo `486431576619`. Reemplazar por `import { CPNU_API_BASE } from "@/lib/api-urls"` y usar `${CPNU_API_BASE}/work-items`.
- `src/hooks/use-work-items-list.ts` (línea 7) — mismo caso, reemplazar por la constante centralizada.

**Edge functions (4)**
- `supabase/functions/andromeda-terminos-proxy/index.ts` (línea 5)
- `supabase/functions/sync-terminos-alertas/index.ts` (línea 11)
- `supabase/functions/cpnu-sync/index.ts` (línea 6)
- `supabase/functions/sync-pp-by-work-item/index.ts` (línea 13)

En cada una, reemplazar el host `*-11974381924.us-central1.run.app` por `*-zcrd2ua7xq-uc.a.run.app` (mismas constantes locales, solo cambia el dominio).

## Notas

- Otros archivos detectados con la cadena "run.app" (`externalProviderClient.ts`, componentes del wizard de proveedores, tests de SSRF) usan ejemplos genéricos o configuración por organización, no las 4 URLs canónicas — no requieren cambio.
- Las edge functions se redeployan automáticamente.
