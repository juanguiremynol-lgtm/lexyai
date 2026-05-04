# Actualización de URLs de APIs al nuevo proyecto GCP

## Contexto

Las 4 APIs de lectura (Andromeda, CPNU, PP, SAMAI) migraron del proyecto GCP `486431576619` al `11974381924`. La URL antigua de Andromeda ya no responde, lo cual rompe `useAndromedaRadicado` y otros flujos.

Verificado: las constantes solo se referencian desde `src/lib/api-urls.ts`; no hay otros archivos con la cadena `486431576619` hardcodeada.

## Cambio

**Archivo único**: `src/lib/api-urls.ts`

Reemplazar las 4 constantes con las nuevas URLs:

```ts
export const CPNU_API_BASE = "https://cpnu-read-api-11974381924.us-central1.run.app";
export const PP_API_BASE = "https://pp-read-api-11974381924.us-central1.run.app";
export const SAMAI_API_BASE = "https://samai-read-api-11974381924.us-central1.run.app";
export const ANDROMEDA_API_BASE = "https://andromeda-read-api-11974381924.us-central1.run.app";
```

## Notas

- Los consumidores (`useAndromedaRadicado`, `use-cpnu-actuaciones`, `use-pp-actuaciones`, `use-samai-actuaciones`, etc.) importan estas constantes y no requieren cambios.
- Edge functions / secretos del backend NO se ven afectados por este archivo (esto es solo cliente). Si las funciones edge tienen URLs hardcodeadas al proyecto viejo, eso requeriría una revisión separada.
