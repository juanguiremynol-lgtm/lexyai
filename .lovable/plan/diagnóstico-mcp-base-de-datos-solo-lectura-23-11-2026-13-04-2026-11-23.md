# Diagnóstico MCP / base de datos (solo lectura, 23/11/2026 13:04 UTC, revisión de419a1c)

## Resultados reales
1. Logs
- Función `mcp`: "No logs found" (logs de la función y logs de la pasarela filtrados por `mcp`, últimos 30 min: 0 filas). Postgres ERROR/FATAL últimos 30 min: 0 filas. No puedo correlacionar con 13:01–13:03 por esta vía: o no se registraron, o el visor de logs no los devuelve. Es una limitación, no prueba de salud.
- Prueba sin sesión 13:05 UTC: `GET /functions/v1/mcp/.well-known/oauth-protected-resource` -> 200 (2,96 s). La función desplegada arranca y responde a la ruta pública de metadatos.
- Prueba sin sesión: `POST /rest/v1/rpc/now` -> 522 tras 19,4 s (la pasarela no obtiene respuesta de la base). Esto coincide con su 504 y contradice mi informe de las 12:57 (estado de la plataforma "reachable", no una consulta real).
- Conclusión: el -32603 es probablemente un error interno de ejecución (las herramientas consultan la base y fallan), no del conector o el transporte. Sin logs, la causa sigue sin confirmar.

2. Errores de la vista previa
- Validador: comprobación de tipos Deno de todo `supabase/functions/*` ("Check supabase/functions/mcp/index.ts", línea 73 del log), 189 líneas de ERROR. Ejemplos: TS7006 "Parameter 'value' implicitly has an 'any' type" y TS2322 "Type 'string' is not assignable to type '"text"'" en `supabase/functions/mcp/index.ts:2421/2437`.

3. Controles del proyecto (sin regenerar)
- `npx tsc -p tsconfig.mcp.json --noEmit` -> exit 0 (fuente correcta, SDK @lovable.dev/mcp-js 0.20.1).
- `deno run -A scripts/check-mcp-artifact.ts` -> "MCP artifact OK: loaded and handler registered", exit 0.
- Entonces el bloqueo de la vista previa viene de un validador incompatible: comprueba con tipos estrictos un JS generado sin tipos. No hace falta reescribir el generador. Tampoco es la causa de la caída actual.

## Cambio mínimo propuesto (requiere su autorización)
1. Base de datos: con su aprobación, hacer un único reinicio normal y repetir `SELECT 1` y la prueba REST. Si vuelve a caer, revisar sesiones y carga.
2. Vista previa: excluir solo `supabase/functions/mcp/index.ts` de la comprobación de tipos Deno. Se haría con la configuración de comprobación del proyecto, no editando ni suprimiendo el artefacto. Así se mantienen los dos controles exigidos por AGENTS.md y se registra la regla en AGENTS.md.
