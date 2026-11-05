Diagnóstico de solo lectura: origen de SAMAI_ESTADOS_BASE_URL (5 nov 2026, 20:48 UTC)

Resultado: con las capacidades de lectura disponibles no se puede certificar qué host usa hoy el runtime desplegado.

- (a) Configuración de esa variable: no existe herramienta de lectura que devuelva su valor ni su huella sin abrir secretos; el listado solo da nombres. No se leyó ningún valor.
- (b) Traza de petición real: el adaptador no registra el host ni la URL (solo «not configured» si falta). Los logs de funciones existentes (`function_logs`) no tienen ninguna coincidencia con `samai-estados-api-`, ni con el primer host ni con el segundo. En las tablas públicas, el único campo de URL relacionado es `provider_instances.base_url` (instancia PLATFORM), que ya conocías y que no certifica la variable.
- Además, `estadoDocumentAccess.ts` tiene el primer host como respaldo en el código. Ese respaldo no aplica al adaptador de estados, que no tiene ninguno.

Limitación exacta: el valor actual no se puede ver ni comparar por huella sin leer el secreto, y ningún log ni registro guardado contiene el hostname de una petición real del adaptador. Público y no certificado: ninguno de los dos hosts queda probado.
