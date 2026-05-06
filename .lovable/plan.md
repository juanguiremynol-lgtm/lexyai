## Revertir URL de CPNU al proyecto anterior

El usuario quiere volver al host antiguo `*-11974381924.us-central1.run.app` para CPNU.

### Cambios

1. **Frontend** — `src/lib/api-urls.ts`
   - `CPNU_API_BASE` → `https://cpnu-read-api-11974381924.us-central1.run.app`

2. **Secret de backend** — actualizar `CPNU_BASE_URL` vía `secrets--update_secret` a:
   - `https://cpnu-read-api-11974381924.us-central1.run.app`
   - Esto afecta automáticamente a todas las edge functions que lo usan (`cpnu-sync`, `cpnu-job-poller`, `sync-by-work-item`, `cpnuAdapter`, etc.).

### Notas
- Solo se cambia CPNU; PP, SAMAI, SAMAI_ESTADOS, TUTELAS, ANDROMEDA quedan como están.
- Las edge functions con URLs hardcodeadas del host nuevo (`zcrd2ua7xq`) para CPNU también deberían revertirse si las hay — verificaré y actualizaré en la implementación si aplica.
