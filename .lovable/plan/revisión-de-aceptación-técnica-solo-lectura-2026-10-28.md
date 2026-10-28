# Revisión de aceptación técnica (solo lectura)

Sin editar, desplegar, tocar cron ni credenciales, y sin cambios de datos.

## Estado actual conocido
- Main local: `5424aeb4` ("Corrigió CALLER_UNAUTHORIZED"). Lleva el arreglo `invokeInternal` para el supervisor, fallback-sync-check y autopilot. Está preparado pero NO desplegado.
- Desplegado el 26/10 (SHA del bundle):
  - sync-by-work-item `3e4a048e…`
  - process-retry-queue `136de82a…`
  - atenia-cron-watchdog `7f9f4177…`
  - detect-remision-succession `fa76fcdf…`
- Supervisor, fallback-sync-check y autopilot siguen en la revisión anterior. Por eso los rechazos `CALLER_UNAUTHORIZED` de las :00 continúan. Causa demostrada: `functions.invoke` de supabase-js 2.118 no envía el bearer cuando la clave tiene formato nuevo.

## Pasos de lectura
1. Obtener los registros de arranque de cada función relevante y la marca `revision`/`adapter_version` en la línea de tiempo de hoy. Así se confirma qué bundle está sirviendo, no lo que dice el repositorio.
2. Leer el contrato `b5f8383b` (vía web) y comparar sus semánticas con lo que guardan hoy la línea de tiempo y la cola: varias entradas por un mismo estado, recuperación documental completa/incompleta/no evaluada, frescura SAMAI de expediente y de estados por separado, y 401/403 sin asumir "expediente privado".
3. Colas: colas iniciales de ACT y PUB, tareas con el intento máximo, fila más antigua, y si alguna consulta inicial supera las 48 h. Verificar con datos, no con el HTTP 200 de la función.
4. Casos:
   - Nicholls: estado 39 fuera de la ventana diaria.
   - Martha: snapshot de la fuente con found=true frente a RECORD_NOT_FOUND de la app. Reconstruir el caller, la caché y el adaptador sin deducir la causa.
   - Esfinge: publicaciones parciales.
   - Sandra: 401/403 aún sin acreditar.

## Condiciones que hoy impiden afirmar aceptación
- El arreglo del caller no está desplegado, ni hay una ejecución programada aceptada con su id.
- Las tareas DEAD_LETTER causadas por el 401 siguen sin reponerse. Requiere decisión de datos.
- El SLA de primera consulta no está demostrado por persistencia, y hay colas iniciales con intentos agotados.
- PENDING_UPSTREAM continúa en publicaciones sin un CASE_QUERY_SUMMARY correlativo del backend.
- La discrepancia de Martha y la ventana de Nicholls no están conciliadas.
- La semántica del contrato `b5f8383b` no está integrada.

## Entrega
Un informe breve que separe "desplegado verificado", "preparado sin desplegar", "evidencia persistida" y "pendiente con bloqueo".
