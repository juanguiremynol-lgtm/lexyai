import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWorkItems from "./tools/list-work-items";
import getWorkItem from "./tools/get-work-item";
import listRecentEstados from "./tools/list-recent-estados";
import getUserContext from "./tools/get-user-context";
import listActuaciones from "./tools/list-actuaciones";
import listPublicaciones from "./tools/list-publicaciones";
import getEstadosHoy from "./tools/get-estados-hoy";
import getActuacionesHoy from "./tools/get-actuaciones-hoy";
import listDeadlines from "./tools/list-deadlines";
import listClients from "./tools/list-clients";
import getClient from "./tools/get-client";
import addNote from "./tools/add-note";
import search from "./tools/search";
import listAlerts from "./tools/list-alerts";
import listHearings from "./tools/list-hearings";
import listTasks from "./tools/list-tasks";
import getDocumentUrl from "./tools/get-document-url";
import addHearing from "./tools/add-hearing";
import listEmailLinks from "./tools/list-email-links";
import listDetectedProcesses from "./tools/list-detected-processes";
import ateniaHealthOverview from "./tools/atenia-health-overview";
import ateniaProviderStatus from "./tools/atenia-provider-status";
import ateniaRecentIncidents from "./tools/atenia-recent-incidents";

// Build issuer from the project ref (Vite inlines this at build time, so it
// stays import-safe). mcp-js requires the direct supabase.co host, never a
// .lovable.cloud proxy. Fallback keeps the sentinel harmless during the
// throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "andromeda-mcp",
  title: "Andromeda Legal",
  version: "0.4.0",
  instructions: [
    "Herramientas de Andromeda para abogados litigantes en Colombia. Todo el acceso está restringido por RLS al usuario autenticado.",
    "Empieza por `get_user_context` para saber con quién hablas y el tamaño de su cartera.",
    "Cartera: `list_work_items`, `get_work_item`, `list_clients`, `get_client`. Para consultas en lenguaje natural ('el caso contra Bancolombia en Medellín') usa `search`.",
    "Detalle por expediente: `list_actuaciones` (actuaciones) y `list_publicaciones` (estados electrónicos).",
    "Documentos: `get_document_url` devuelve un enlace temporal al PDF de una publicación; nunca genera documentos nuevos.",
    "Correo: `list_email_links` muestra los correos vinculados a un expediente (solo metadatos, nunca el cuerpo) y `list_detected_processes` la cola de radicados hallados en el buzón que aún no existen como expediente.",
    "Agenda diaria: `get_estados_hoy` y `get_actuaciones_hoy`; 'hoy' siempre es el día calendario en America/Bogota.",
    "Agenda y pendientes: `list_hearings` (audiencias), `list_tasks` (tareas) y `list_alerts` (alertas sin resolver).",
    "Términos: `list_deadlines`. Los términos con estado PENDING_REVIEW provienen de un backfill histórico y NO son obligaciones vigentes.",
    "Escritura: solo `add_note` y `add_hearing`, y ambas exigen el permiso `read_write`. Nunca existe eliminación, reclasificación ni cambio de ciclo de vida vía MCP.",
    "No inventes plazos ni cifras: si una herramienta no devuelve el dato, dilo explícitamente.",
    "Las herramientas `atenia_*` son exclusivas de administradores de la plataforma; para cualquier otro usuario devuelven un rechazo limpio. No las ofrezcas si el usuario no es administrador.",
  ].join(" "),
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getUserContext,
    search,
    listWorkItems,
    getWorkItem,
    listActuaciones,
    listPublicaciones,
    listRecentEstados,
    getEstadosHoy,
    getActuacionesHoy,
    listDeadlines,
    listAlerts,
    listHearings,
    listTasks,
    getDocumentUrl,
    listEmailLinks,
    listDetectedProcesses,
    listClients,
    getClient,
    addNote,
    addHearing,
    ateniaHealthOverview,
    ateniaProviderStatus,
    ateniaRecentIncidents,
  ],
});
