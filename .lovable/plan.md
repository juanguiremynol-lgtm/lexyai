# VV — Cobertura real de estados

## Objetivo
Corregir la ejecución incompleta de los canales de estados, preservar de forma fiel sus resultados y preparar la medición histórica para alertas futuras, sin activar alertas ni alterar datos históricos o procesales.

## Implementación

### 1. Publicaciones Procesales: corrida completa y resultado honesto
- Sustituir el corte fijo de 50 segundos por invocaciones encadenadas y acotadas: cada ejecución procesa un lote pequeño, persiste progreso y programa el siguiente lote solo si quedan asuntos.
- Incorporar bloqueo de ejecución única, presupuesto de profundidad, enfriamiento entre saltos e idempotencia por asunto/corrida.
- Registrar siempre `selected_count` y `attempted_count`; usar `PARTIAL` cuando sean distintos, aunque no haya errores HTTP.
- Mantener orden por antigüedad de lectura, pero eliminar la falsa finalización `OK` tras el primer lote.
- Auditar los asuntos con registro PP en error y determinar si el flujo corregido los reintenta o si requieren nueva inscripción, sin reconsultarlos históricamente.

### 2. SAMAI Estados: programación diaria
- Crear un coordinador específico para los asuntos cuyo enrutamiento canónico incluye `SAMAI_ESTADOS`, reutilizando el sincronizador existente y sin permitir cruces PP/CPACA.
- Programarlo diariamente antes del digest, con bajo paralelismo para los 13 asuntos actuales.
- Aplicar el mismo contrato de completitud: `OK` solo si todos los seleccionados fueron intentados; cualquier truncamiento o fallo parcial queda como `PARTIAL`.
- Ejecutar y verificar la primera corrida; informar el resultado almacenado por asunto, incluido el radicado terminado en `0007801`.

### 3. Resultado canónico y reclasificación no destructiva
- Añadir `outcome` de primer nivel a cada objeto de `provider_attempts` nuevo y conservar `status` como compatibilidad.
- Persistir expresamente `PENDING_UPSTREAM`, `SCRAPING_INITIATED` y `PROCESO_PRIVADO`; este último tendrá categoría propia y no contará como lectura usable ni como error técnico.
- Cambiar las vistas y funciones de cobertura para clasificar primero por `outcome` y solo recurrir a `status` si el resultado canónico no existe.
- No modificar ningún intento histórico: la serie corregida se calculará al leer los JSON existentes.
- Exponer una comparación semanal de métrica actual versus corregida.

### 4. Prerrequisito del futuro detector de caída
- Excluir del conjunto esperado asuntos archivados y asuntos cuya evidencia persistida indique “al despacho para sentencia”.
- Persistir una línea base semanal por fuente y preparar el evaluador aceptado: mediana móvil de 3 semanas, WARN a −20 puntos, CRITICAL a −35 o cero lecturas usables con intentos, supresión con menos de 5 esperados y cuatro semanas de siembra.
- No crear, habilitar ni despachar alertas en esta entrega.

## Verificación y reporte
- Añadir pruebas de regresión para truncamiento, conteos seleccionado/intentos, enrutamiento, resultados canónicos, fallback por compatibilidad y exclusión por ubicación procesal.
- Desplegar los coordinadores y cambios de lectura, registrar los cron mediante configuración de backend y verificar trazas/filas de corrida.
- Reportar: intervalo histórico máximo entre lecturas PP; causa y destino de los registros PP en error; primera corrida SAMAI Estados por asunto; serie semanal actual/corregida; cobertura corregida tras exclusiones.
- La cobertura de tres días consecutivos se observará durante tres días reales; esta entrega dejará la medición instalada y reportará solo los días efectivamente disponibles, sin fabricar resultados.

## Límites
- No activar alertas de cobertura.
- No reescribir `provider_attempts` históricos.
- No ejecutar backfills contra proveedores.
- No crear términos ni fechas límite.
- No cambiar etapas, estados procesales, alertas ni asuntos.
