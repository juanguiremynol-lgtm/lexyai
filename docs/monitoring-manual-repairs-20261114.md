# Reparaciones manuales de monitoreo — estado aplicado el 14/11/2026

Este documento versiona tres cambios que el propietario ya aplicó manualmente. Esta intervención **no los reaplicó ni los revirtió**. El script canónico es `supabase/release/monitoring_coverage_fix_20261114.sql`; su reversión explícita está en `supabase/release/monitoring_coverage_rollback_20261114.sql`.

## Evidencia autorizada

1. Auditoría `2c523029-fd30-4f22-8b6f-37c9e6bf54f1`: `public.monitoring_coverage_v` quedó con `security_invoker=true`. Hash de definición registrado: `b8e7f50a2ab1b2235315818f6cdd51cb`. Reversión registrada: retirar esa opción, sin reemplazar la definición.
2. Auditoría `aeec4601-b0c7-49c8-b9b2-1c6eea97e2bd`: se retiraron los índices redundantes `idx_work_item_acts_org` e `idx_work_item_acts_work_item`, conservando respectivamente `idx_work_item_acts_owner` e `idx_work_item_acts_work_item_id`. No se afirma una mejora de latencia.
3. Auditoría `da11b4f5-e13f-49ab-91e5-43f2cec0a75f`: `public.detect_stale_monitoring(integer)` usa inscripciones habilitadas canónicas y consulta historial solo para candidatos con brecha. Hash posterior: `81078e852c70e526b9c80807abbae7f0`; hash anterior: `b2b37d1e88f335e412326aa099f5b193`.

## Instalación y verificación idempotentes

El script de instalación:

- exige el esquema y los índices equivalentes necesarios antes de retirar redundancias;
- solo fija la opción `security_invoker=true` de la vista, preservando cualquier definición futura;
- admite únicamente el hash anterior o posterior conocido de la función y se detiene ante una versión desconocida;
- instala la definición posterior exacta y comprueba su hash, las opciones de la vista y los índices finales;
- puede ejecutarse de nuevo sobre el estado posterior sin cambiar resultados.

No se ejecuta automáticamente desde el despliegue de funciones. Requiere una sesión privilegiada de mantenimiento. La reversión también está acotada por hash para no restaurar una función obsoleta sobre una versión desconocida.

## Pruebas ya ejecutadas por el propietario

Se conservan como evidencia reportada, no como pruebas repetidas en este pase: lecturas de vista anon=0, otro actor=0 y titular=81; detector en 63,909 ms, 0 alertas y 68 inscripciones completas; 14 fixtures de elegibilidad aprobados. Las pruebas transaccionales 7/7 de admisión diaria son independientes y no certifican OAuth.

El antiguo `supabase/tests/monitoring_coverage_equivalence_20261114.sql` queda como antecedente aislado del candidato previo; no forma parte de la instalación del estado manual aplicado.
