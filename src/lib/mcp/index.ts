import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWorkItems from "./tools/list-work-items";
import getWorkItem from "./tools/get-work-item";
import listRecentEstados from "./tools/list-recent-estados";

// Build issuer from the project ref (Vite inlines this at build time, so it
// stays import-safe). mcp-js requires the direct supabase.co host, never a
// .lovable.cloud proxy. Fallback keeps the sentinel harmless during the
// throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "andromeda-mcp",
  title: "Andromeda Legal",
  version: "0.1.0",
  instructions:
    "Herramientas de Andromeda para abogados en Colombia. Usa `list_work_items` para listar asuntos del usuario, `get_work_item` para ver detalles y actuaciones, y `list_recent_estados` para novedades judiciales recientes. Toda información queda restringida al usuario autenticado vía RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWorkItems, getWorkItem, listRecentEstados],
});