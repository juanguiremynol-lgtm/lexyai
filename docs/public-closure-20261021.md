# Cierre público: entrega y límites — 21 octubre 2026

## Código y coordinación
- HEAD observado tras cambios: `48d4f33964cde171fcd73b2e0119dbd2bc7c40fd`; no se creó un commit manual.
- Se reconciliaron cinco diagnósticos del manifiesto y dos pruebas del adaptador; además se corrigieron errores de tipos de los importadores afectados. Las 13 entradas pasan `deno check --node-modules-dir=none` (resuelve las dependencias de ejecución, no la copia antigua instalada en la interfaz).
- Backend externo no desplegado de nuevo. SQL0045 conservado; evidencias originales y compatibilidad de copias anteriores conservadas.

## Migraciones aplicadas
1. `drizzle/migrations/0046_public_monitor_durable.sql`: protocolo corregido; siembra hoy antes de recuperar ayer, leases, 3 intentos y fencing. Sin nuevo dispatcher.
2. `drizzle/migrations/0047_notification_user_state.sql`: estado personal, inbox y RPC confirmada.
3. `drizzle/migrations/0048_notification_personal_read_isolation.sql`: lecturas compartidas no marcan leído para otra persona.
- No aplicar otra vez el protocolo ni la alternativa `coordination/20261021010000_public_monitor_daily_seed.sql`.
- Pendiente al final: `coordination/20261020011000_public_monitor_dispatch.sql`.

## Funciones desplegadas
`scheduled-publicaciones-monitor`, `scheduled-samai-estados-monitor`, `scheduled-daily-estados`, `scheduled-daily-sync`, `sync-publicaciones-by-work-item`, `admin-diagnose-estados`, `atenia-ai-autopilot`, `bridge-reconcile`, `fallback-sync-check`, `orchestrator-debug-run`, `process-retry-queue`, `provider-sync-external-provider`, `sync-by-work-item`.

Huellas del código enviado, NO commits Git ni metadatos de versión desplegada:
- PP monitor: `e5447561fd7384d943fda691f954b75e1df8758583e33187a99f234cb4284127`
- SAMAI monitor: `59dd5774b03871e97ffcf0ace81f0544a7a837be55d3f9ea9305f2fb3beb197d`
- daily-estados: `845d3ded94eb70f9605d8a2cda928bf1cb912cd22565f0bc70dd2af90e725bfd`
- daily-sync: `ac926576f8e75d94a9e333fb9fd628bc7812bd332d0e0698031b4bd47aba1158`
- sync-publicaciones: `ba9f5f4a9e6dbe0b921a4dadcb5a6023c12c81535fe1e57005c694eaeeb35719`
- sync-by-work-item: `d8023a1ed454b13d5f4d9be7a7570c59cdcf07eb18cf46d9908b2429fa817a1f`

## Cron y autenticación comprobados
- Job 64 `andromeda-daily-estados` pausado: llamada antigua sin auth compatible.
- Jobs 66 `daily-sync`, 91 `publicaciones-monitor`, 92 `samai-estados-monitor` siguen activos (consulta real).
- POST real con clave runtime: monitores pasan auth y llegan al rechazo de corrida inexistente (500); sin clave, 401. Sync-publicaciones con clave llega a validación MISSING_WORK_ITEM_ID (400). Daily-sync sin credencial rechaza dry-run (401).
- Estas pruebas NO prueban una corrida completa ni la llamada del dispatcher.
- No hay canal disponible que permita escribir Vault con valores coincidentes del runtime sin revelar valores, persistir SQL literal o eludir permisos. Project Settings → Secrets solo almacena secretos de funciones: no llena Vault.
- Acción exacta pendiente de coordinación: Codex debe sembrar `CRON_SERVICE_KEY` y `SUPABASE_URL` en Vault mediante su canal privilegiado seguro usando los valores técnicos existentes, sin imprimirlos; verificar solo nombres, aplicar dispatcher y observar ejecución real. No rotar/recrear una clave distinta en un solo lado.

## Notificaciones y documentos
- Descarte/aplazamiento personal conservan historia; contexto usuario/organización/categoría, cancelación, rollback e invalidación; RPC exige todas las filas confirmadas. Superadmin conserva asuntos propios y operaciones separados.
- Publicaciones civiles ahora muestran botones explícitos para abrir/descargar copias verificadas y páginas del paquete; no se atribuye lectura a enlaces candidatos.
- Sesión autorizada de preview restaurada: seis rutas reales inspeccionadas, centro de notificaciones visible. Descargas seleccionadas de Retiro, Miriam, Yolanda y Familia finalizadas correctamente.
- En Chromium headless, abrir el PDF dispara una descarga en la ventana reservada (el visor PDF no se renderiza); no se certifica inspección visual del contenido del PDF ni todas las copias de todos los casos. Rionegro y J19 requieren completar la prueba de documentos.
- No se descartaron novedades reales como prueba; no se ejecutaron correos externos ni reparación histórica SAMAI ni pruebas de términos.

## Pruebas
- 26 Deno: veredictos, frescura, elegibilidad, documentos, adaptador y ejecución monitor.
- 68 Vitest: inventario, acceso/UI documentos, idempotencia, confirmación y rollback/cache de notificaciones.
- PostgreSQL desechable: 503 procesos, hoy/ayer, inclusión al siguiente snapshot, fencing, 3 intentos, repetición idempotente y dispatcher local; dos usuarios, persistencia y lectura personal aislada.
- Build preview OK. Estas pruebas locales NO cierran el circuito público.
- Publicación de interfaz solicitada; confirmar entrega productiva aparte. MCP no modificado ni redesplegado; se conserva catálogo 33.
