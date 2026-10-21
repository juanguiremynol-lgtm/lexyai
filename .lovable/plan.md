# Huella de sync-publicaciones-by-work-item: resultado de la comprobación (sin cambios)

No se puede obtener la huella completa desde metadatos desplegados con las herramientas disponibles:

- Los registros de ejecución de funciones (deployment_id, version) no contienen ninguna invocación de sync-publicaciones-by-work-item dentro del periodo que conservan; las dos consultas devolvieron cero filas.
- No dispongo de una herramienta de solo lectura que devuelva los metadatos de despliegue de una función (hash, versión, fecha).
- El valor completo no quedó en el historial accesible; solo el prefijo c5cbe222… que se reportó en el turno de despliegue.

No se afirma ninguna equivalencia con commits Git ni con el SHA de main. El valor queda sin verificar hasta que exista una invocación registrada o un canal que exponga los metadatos de despliegue.

Sin ediciones, despliegues, activación de dispatcher, cron, interfaz, notificaciones ni MCP.
