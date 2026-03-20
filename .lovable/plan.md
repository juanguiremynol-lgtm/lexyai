

## Plan: Actualizar pp_id para radicado existente

### Contexto
El work item `fb2e68d7-0c1b-4b45-b518-cd5d5615a83b` (radicado `05030318900120230006300`) fue registrado en PP API antes de implementar la captura de `pp_id`. La columna `pp_id` está vacía en la base de datos.

### Cambio
Ejecutar una actualización de datos (no migración de esquema):

```sql
UPDATE work_items 
SET pp_id = 1 
WHERE radicado = '05030318900120230006300';
```

Esto se ejecutará usando la herramienta de inserción/actualización de datos de la base de datos. No se requieren cambios de código.

### Resultado esperado
Tras la actualización, el tab "Publicaciones" del work item mostrará las actuaciones de PP correctamente, ya que el hook `usePpActuaciones` recibirá `ppId = 1` y llamará a `GET /work-items/1/actuaciones`.

