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
import listActAttachments from "./tools/list-act-attachments";
import addHearing from "./tools/add-hearing";
import listEmailLinks from "./tools/list-email-links";
import listDetectedProcesses from "./tools/list-detected-processes";
import ateniaHealthOverview from "./tools/atenia-health-overview";
import ateniaProviderStatus from "./tools/atenia-provider-status";
import ateniaRecentIncidents from "./tools/atenia-recent-incidents";
import listAppScreens from "./tools/list-app-screens";
import describeDataModel from "./tools/describe-data-model";
import queryTable from "./tools/query-table";
import updateWorkItem from "./tools/update-work-item";
import manageDeadline from "./tools/manage-deadline";
import manageTask from "./tools/manage-task";
import emailIntegrationStatus from "./tools/email-integration-status";
import whatsappNotices from "./tools/whatsapp-notices";
import whatsappPrepare from "./tools/whatsapp-prepare";
import getCapabilities from "./tools/get-capabilities";
import listWorkflowStages from "./tools/list-workflow-stages";
import createWorkItem from "./tools/create-work-item";
import changeWorkItemLifecycle from "./tools/change-work-item-lifecycle";
import moveWorkItemStage from "./tools/move-work-item-stage";
import listStageSuggestions from "./tools/list-stage-suggestions";
import resolveStageSuggestion from "./tools/resolve-stage-suggestion";
import resolveAlert from "./tools/resolve-alert";
import listNotifications from "./tools/list-notifications";
import setNotificationState from "./tools/set-notification-state";
import resolveEmailQuestion from "./tools/resolve-email-question";
import addEmailAssociation from "./tools/add-email-association";
import resolveDetectedProcess from "./tools/resolve-detected-process";
import listUpdates from "./tools/list-updates";

// Build issuer from the project ref (Vite inlines this at build time, so it
// stays import-safe). mcp-js requires the direct supabase.co host, never a
// .lovable.cloud proxy. Fallback keeps the sentinel harmless during the
// throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "andromeda-mcp",
  title: "Andromeda Legal",
  version: "0.6.0",
  instructions: [
    "Herramientas de Andromeda para abogados litigantes en Colombia. Todo el acceso está restringido por RLS al usuario autenticado.",
    "Empieza por `get_user_context` para saber con quién hablas y el tamaño de su cartera.",
    "Cartera: `list_work_items`, `get_work_item`, `list_clients`, `get_client`. Para consultas en lenguaje natural ('el caso contra Bancolombia en Medellín') usa `search`, que también acepta radicados con guiones, parciales y correos de despacho.",
    "Radicados: cualquier parámetro `radicado` acepta la forma con guiones, con espacios, la base de 21 dígitos, 22 dígitos sin el cero inicial o base+instancia. Si la base coincide con varias instancias se resuelve la activa y se informa en el campo `resolucion`.",
    "Detalle por expediente: `list_actuaciones` (actuaciones) y `list_publicaciones` (estados electrónicos).",
    "Documentos: `get_document_url` devuelve un enlace temporal al PDF de una publicación; nunca genera documentos nuevos. `list_act_attachments` (solo exige act_id) da el inventario de anexos de una actuación: estado explícito con causa, archivos recuperados y pendientes; una cabecera PDF no acredita lectura completa ni correspondencia documental. Solo declarar disponible con descarga completa, lectura y asociación comprobadas; el hash da trazabilidad. Sin evidencia = desconocido, nunca 'sin anexos'. Distingue ACTUACIÓN de ESTADO y conserva sus relaciones sin fusionarlos. Para cautelares distingue solicitud, traslado, negativa y decreto; no infieras concesión por palabras aisladas. Comprueba autor, contexto y parte resolutiva del PDF y conserva página y cita. Indica si solo tienes metadatos o falta el documento. Evalúa tareas y términos aparte de la clase del evento.",
    "Correo: `list_email_links` muestra los correos vinculados a un expediente (solo metadatos, nunca el cuerpo) y `list_detected_processes` la cola de radicados hallados en el buzón que aún no existen como expediente.",
    "Agenda diaria: `get_estados_hoy` y `get_actuaciones_hoy`; 'hoy' siempre es el día calendario en America/Bogota.",
    "Agenda y pendientes: `list_hearings` (audiencias), `list_tasks` (tareas) y `list_alerts` (alertas sin resolver).",
    "Términos: `list_deadlines`. Los términos con estado PENDING_REVIEW provienen de un backfill histórico y NO son obligaciones vigentes.",
    "Datos crudos: `describe_data_model` lista las tablas consultables y `query_table` ejecuta lecturas filtradas sobre ellas con el token del usuario (RLS aplicado, nunca SQL libre).",
    "Pantallas: `list_app_screens` devuelve el mapa de la interfaz con enlaces directos, para decirle al usuario exactamente dónde mirar o abrirle un asunto.",
    "Correo: `email_integration_status` reporta la casilla conectada para lectura y los envíos salientes de Andromeda; nunca expone tokens ni cuerpos de terceros.",
    "WhatsApp a clientes: `whatsapp_notices` (consentimientos, borradores, enviados) y `whatsapp_prepare` (registrar/revocar consentimiento, preparar, editar o descartar borradores). NINGUNA herramienta aprueba ni envía mensajes: eso solo ocurre en la pantalla Avisos WhatsApp, uno por uno.",
    "Permisos: `get_capabilities` dice si esta conexión es de solo lectura o puede gestionar. Gestionar exige que el usuario lo active él mismo en Andromeda → Conectar IA; ningún argumento de herramienta (confirm, user_id, client_id) lo sustituye, y la base de datos verifica el permiso en cada escritura.",
    "Escritura (solo con instrucción explícita del usuario y permiso de gestión): `add_note`, `add_hearing`, `update_work_item`, `manage_deadline`, `manage_task`, `create_work_item`, `change_work_item_lifecycle` (archivar, papelera recuperable 10 días, restaurar), `move_work_item_stage` y `resolve_stage_suggestion` (con `list_workflow_stages` y `list_stage_suggestions`), `resolve_alert` (alertas de `list_alerts`) y `set_notification_state` (notificaciones de `list_notifications`), `resolve_email_question` y `add_email_association`, `resolve_detected_process`. Cada escritura exige `idempotency_key`; las de etapa y ciclo de vida exigen `expected_updated_at`. Nunca hay borrado definitivo, cambio de radicado o tipo de proceso, administración de cuentas ni envío de correos; asociar un correo o descartar una alerta nunca cambia etapas ni cumple términos.",
    "Novedades: `list_updates` entrega actuaciones, estados y cambios de ciclo de vida con cursor reanudable; deduplica por `dedupe_key` y lee `freshness` antes de afirmar que no hay novedades.",
    "No inventes plazos ni cifras: si una herramienta no devuelve el dato, dilo explícitamente.",
    "Las herramientas `atenia_*` son exclusivas de administradores de la plataforma; para cualquier otro usuario devuelven un rechazo limpio. No las ofrezcas si el usuario no es administrador.",
  ].join(" "),
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    // Public, non-secret revision marker served by the unauthenticated
    // protected-resource metadata, so a deploy can be confirmed from outside.
    resourceDocumentation: "https://andromeda.legal/connect-ai/mcp-rev-0-6-0",
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
    listActAttachments,
    listEmailLinks,
    listDetectedProcesses,
    listClients,
    getClient,
    addNote,
    addHearing,
    listAppScreens,
    describeDataModel,
    queryTable,
    updateWorkItem,
    manageDeadline,
    manageTask,
    emailIntegrationStatus,
    whatsappNotices,
    whatsappPrepare,
    getCapabilities,
    listWorkflowStages,
    createWorkItem,
    changeWorkItemLifecycle,
    moveWorkItemStage,
    listStageSuggestions,
    resolveStageSuggestion,
    resolveAlert,
    listNotifications,
    setNotificationState,
    resolveEmailQuestion,
    addEmailAssociation,
    resolveDetectedProcess,
    listUpdates,
    ateniaHealthOverview,
    ateniaProviderStatus,
    ateniaRecentIncidents,
  ],
});
