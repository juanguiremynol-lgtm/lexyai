# Plan SGC digital (ISO 9001) — solo en el draft

## Estado verificado
- Draft `drft_01m7na2nx3e7bveh7x6kca6z3q` existe, sin cambios, con base de pruebas propia aislada (los datos no llegan a producción).
- Herramientas MCP ya existentes y reutilizables: `create_client`, `update_client`, `get_client`, `list_clients`, `create_work_item`, `update_work_item`, `create_peticion`, `get_work_item`, `search`, `get_document_url`, `add_email_association`, `get_capabilities`.
- Tablas canónicas: `clients` (migración 20251222204912), `work_items`, `generated_documents` (20260220012311 + ajustes 20260820). Funciones existentes de documentos: digest/verify/delete-generated-document, bulk-export-documents.
- `register_filing` retirado (0111, EXECUTE revocado). No se reintroduce.

## Reutilización para intake → cliente → asunto
1. Intake: sin tabla nueva por defecto; se proyecta a `clients` vía `mcp_create_client`/`mcp_update_client` (sin fusión por nombre, conflicto por identificación, org desde perfil).
2. Asunto: `mcp_create_work_item` / `mcp_create_peticion` con protocolo de radicación confirmada y búsqueda previa de duplicados.
3. Documentos SGC (formatos, registros): `generated_documents` con su ciclo de estados y retención; Excel/SharePoint solo como proyección.
4. MCP OAuth: identidad fail-closed, grant manage por usuario+cliente, idempotencia `_mcp_begin/_mcp_finish` y auditoría; cualquier RPC nueva nace con EXECUTE revocado (release gated).

## Cómo trabajar solo en el draft
- Enviar el encargo al chat del draft (desde main solo puede crearse; las instrucciones van en su propio hilo).
- Migraciones, código y pruebas se aplican en la base aislada del draft; sin publicar, sin aceptar el draft hasta revisión.
- No desplegar funciones ni el MCP (solo sale publicando la app, que es de main).

## Qué impide implementación directa
- El paquete de diseño está en SharePoint y no es legible desde aquí: hay que pegar o adjuntar el contenido (modelo de datos, formatos, flujos) en el chat del draft.
- Aceptar el draft fusiona a main; publicar cambia producción y el MCP vivo — requiere autorización expresa aparte.
- Consultas a la base de main dieron conexión no disponible en esta sesión; verificar ACL/datos antes de diseñar migraciones.
- Revisión de seguridad desactualizada; repetirla antes de aceptar.

## Restricciones
Sin cron, sondeo ni productor nuevo; sin borrado de historial; Tiny; una actualización diaria por asunto; UI en español; `clients`/`work_items` canónicos.
