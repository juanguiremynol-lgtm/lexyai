

## Plan: Agregar dominios Andromeda y Samai a CSP

### Cambio en `index.html`

Extender `connect-src` en el meta CSP para incluir los dos endpoints de Cloud Run que faltan:

```html
connect-src 'self' 
  https://*.supabase.co 
  wss://*.supabase.co 
  https://cpnu-read-api-486431576619.us-central1.run.app 
  https://pp-read-api-486431576619.us-central1.run.app 
  https://andromeda-read-api-486431576619.us-central1.run.app 
  https://samai-read-api-486431576619.us-central1.run.app;
```

- `andromeda-read-api`: requerido por `EstadosHoy.tsx` y `andromeda-novedades.ts`.
- `samai-read-api`: incluido preventivamente porque `mem://features/integracion-samai-cpaca` confirma que se usa para CPACA y podría ser llamado desde el navegador en otros componentes.

### Verificación posterior
Tras el cambio, recargar `/app/estados-hoy` con DevTools → Network. El fetch a `andromeda-read-api-.../novedades` debe pasar de "Failed to fetch" a un status HTTP real (200 o el error que devuelva la API).

### Fuera de alcance
- No se toca `vite.config.ts` (la CSP no vive ahí).
- No se modifican headers de Edge Functions (ortogonal al problema).
- No se cambia `EstadosHoy.tsx` ni `andromeda-novedades.ts`.

