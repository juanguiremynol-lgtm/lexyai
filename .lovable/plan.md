

## Plan: Asignar pp_id a 9 work_items y verificar tab Publicaciones

### Paso 1 — Ejecutar UPDATEs en Supabase
Usar la herramienta de inserción/actualización de datos para ejecutar los 9 UPDATE statements que asignan el `pp_id` numérico a cada work_item según su radicado.

### Paso 2 — Verificar en navegador
Navegar al work_item con radicado `05001400301620220106300` (pp_id = 3) y abrir el tab "Publicaciones" para confirmar que:
- Se cargan las actuaciones desde la PP API
- Los botones "Ver Auto" y "Ver Tabla" aparecen donde corresponda

### Alcance técnico
- Solo se modifican datos existentes (UPDATE), no estructura de tablas
- El hook `usePpActuaciones` ya consume `workItem.pp_id` para llamar a `PP_API_BASE/work-items/{ppId}/actuaciones`
- Una vez asignado el `pp_id`, el tab dejará de mostrar "Registrando en PP..." y cargará las actuaciones reales

