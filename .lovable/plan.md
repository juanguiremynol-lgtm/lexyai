

## Plan: Asignar pp_id a 12 work_items procesados por PP

### Acción
Ejecutar 12 UPDATE statements en la tabla `work_items` usando la herramienta de inserción de datos (no migración, ya que son cambios de datos, no de esquema).

### SQL a ejecutar
```sql
UPDATE work_items SET pp_id = 8 WHERE radicado = '05001233300020240115300';
UPDATE work_items SET pp_id = 9 WHERE radicado = '05001310302120250021100';
UPDATE work_items SET pp_id = 11 WHERE radicado = '05001333300320190025200';
UPDATE work_items SET pp_id = 10 WHERE radicado = '05001400301120240210000';
UPDATE work_items SET pp_id = 6 WHERE radicado = '05001400301520240193000';
UPDATE work_items SET pp_id = 3 WHERE radicado = '05001400301620220106300';
UPDATE work_items SET pp_id = 2 WHERE radicado = '05001400301620230029800';
UPDATE work_items SET pp_id = 5 WHERE radicado = '05001400302020250187800';
UPDATE work_items SET pp_id = 7 WHERE radicado = '05001400302320250063800';
UPDATE work_items SET pp_id = 1 WHERE radicado = '05030318900120230006300';
UPDATE work_items SET pp_id = 12 WHERE radicado = '05030318900120250000200';
UPDATE work_items SET pp_id = 4 WHERE radicado = '11001418904220250174800';
```

### Verificación
Después de ejecutar, consultar los 12 registros para confirmar que todos tienen su `pp_id` asignado correctamente.

### Impacto
- El tab "Publicaciones" dejará de mostrar "Registrando en PP..." para estos 12 work_items
- Se cargarán las actuaciones reales desde la PP API usando el `pp_id` asignado
- No hay cambios de código ni de esquema

