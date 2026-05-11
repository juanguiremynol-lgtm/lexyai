# Arreglar CSP que bloquea andromeda-read-api

## Diagnóstico

`index.html` línea 18 contiene la directiva `connect-src` con dominios del proyecto Cloud Run viejo (`486431576619`). Las llamadas a la API nueva (`11974381924`) están bloqueadas por CSP. No hay CSP en hosting (`vercel.json`/`_headers`/`vite.config.ts`) — toda la política vive en el `<meta http-equiv>` de `index.html`.

## Cambio

Reemplazar la línea `connect-src` actual por una que incluya:

- Lo existente: `'self'`, `https://*.supabase.co`, `wss://*.supabase.co`
- Los 4 dominios del proyecto nuevo `11974381924`:
  - `https://andromeda-read-api-11974381924.us-central1.run.app` (el que se usa hoy)
  - `https://cpnu-read-api-11974381924.us-central1.run.app`
  - `https://pp-read-api-11974381924.us-central1.run.app`
  - `https://samai-read-api-11974381924.us-central1.run.app`
  - `https://samai-estados-api-11974381924.us-central1.run.app`
  - `https://publicaciones-procesales-api-11974381924.us-central1.run.app`

Los dominios viejos `486431576619` se eliminan (ya no apuntan a nada vigente).

## Archivo a editar

- `index.html` línea 18 — solo la directiva `connect-src` dentro del `<meta http-equiv="Content-Security-Policy">`.

## Verificación

1. Hard reload (Ctrl+Shift+R) en `/app/radicados/05001400301520240193000`.
2. Consola: ya no debe aparecer `Refused to connect because it violates the document's Content Security Policy`.
3. Network filtrando por `andromeda-read-api`:
   - `GET /radicados/05001400301520240193000` → 200
   - `GET /radicados/05001400301520240193000/actuaciones` → 200 con 42 filas
4. UI: pestaña Actuaciones muestra 42 filas; panel Sync muestra el desglose multi-fuente.
