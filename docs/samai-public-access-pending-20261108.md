# Acceso público del lector SAMAI — pendiente

El informe de Cloud Shell del 8 de noviembre identifica un binding `allUsers` para `samai-read-api` y una lectura de expediente exitosa sin autenticación. La revisión de código también muestra rutas de registro, revisión de novedades y solicitud de jobs sin verificación de autenticación aparente; no se probaron esas mutaciones en producción.

El propietario indicó posponer la intervención mientras se prioriza la confiabilidad. No se modificaron IAM, las credenciales ni esas rutas. Antes de restringir el acceso, identificar y probar todos los consumidores: el adaptador de actuaciones puede enviar `x-api-key`, mientras el resumen diario consulta `/samai-estados/fechas-por-perder` sin clave. Cualquier solución debe proteger los datos y las mutaciones, preservar los consumidores autorizados y probarse con datos sintéticos para no lanzar trabajos ni modificar asuntos reales.

Evidencia del lector: `docs/samai-reader-stream-20261108.md` en la rama `fix/samai-reader-stream-20261108` del repositorio privado de Cloud.
