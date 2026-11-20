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
import createClient from "./tools/create-client";
import updateClient from "./tools/update-client";
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
import createPeticion from "./tools/create-peticion";
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
import listEmailQuestions from "./tools/list-email-questions";
import assignWorkItemRadicado from "./tools/assign-work-item-radicado";
import listFreshnessIssues from "./tools/list-freshness-issues";

// Build issuer from the project ref (Vite inlines this at build time, so it
// stays import-safe). mcp-js requires the direct supabase.co host, never a
// .lovable.cloud proxy. Fallback keeps the sentinel harmless during the
// throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "andromeda-mcp",
  title: "Andromeda Legal",
  version: "0.8.2",
  instructions: [
    "Herramientas de Andromeda para abogados litigantes en Colombia. Todo el acceso está restringido por RLS al usuario autenticado.",
    "Empieza por `get_user_context` para saber con quién hablas y el tamaño de su cartera.",
    "Cartera: `list_work_items`, `get_work_item`, `list_clients`, `get_client`. Para consultas en lenguaje natural ('el caso contra Bancolombia en Medellín') usa `search`, que también acepta radicados con guiones, parciales y correos de despacho.",
    "Radicados: cualquier parámetro `radicado` acepta la forma con guiones, con espacios, la base de 21 dígitos, 22 dígitos sin el cero inicial o base+instancia. Si la base coincide con varias instancias se resuelve la activa y se informa en el campo `resolucion`.",
    "Detalle por expediente: `list_actuaciones` (actuaciones) y `list_publicaciones` (estados electrónicos).",
    "Documentos: `get_document_url` devuelve un enlace temporal al PDF de una publicación; nunca genera documentos nuevos. `list_act_attachments` (solo exige act_id) da el inventario de anexos de una actuación: estado explícito con causa, archivos recuperados y pendientes; una cabecera PDF no acredita lectura completa ni correspondencia documental. Solo declarar disponible con descarga completa, lectura y asociación comprobadas; el hash da trazabilidad. Sin evidencia = desconocido, nunca 'sin anexos'. Distingue ACTUACIÓN de ESTADO y conserva sus relaciones sin fusionarlos. Para cautelares distingue solicitud, traslado, negativa y decreto; no infieras concesión por palabras aisladas. Comprueba autor, contexto y parte resolutiva del PDF y conserva página y cita. Indica si solo tienes metadatos o falta el documento. Evalúa tareas y términos aparte de la clase del evento.",
    "Correo: `list_email_questions` descubre preguntas pendientes agrupadas por mensaje, con candidatos, conflictos y acciones permitidas; `list_email_links` consulta un expediente. Solo metadatos, nunca cuerpos ni envíos. `list_detected_processes` consulta radicados del buzón aún sin expediente.",
    "Agenda diaria: `get_estados_hoy` y `get_actuaciones_hoy`; 'hoy' siempre es el día calendario en America/Bogota.",
    "Agenda y pendientes: `list_hearings` (audiencias), `list_tasks` (tareas) y `list_alerts` (alertas sin resolver).",
    "Términos: `list_deadlines`. Los términos con estado PENDING_REVIEW provienen de un backfill histórico y NO son obligaciones vigentes.",
    "Datos crudos: `describe_data_model` lista las tablas consultables y `query_table` ejecuta lecturas filtradas sobre ellas con el token del usuario (RLS aplicado, nunca SQL libre).",
    "Pantallas: `list_app_screens` devuelve el mapa de la interfaz con enlaces directos, para decirle al usuario exactamente dónde mirar o abrirle un asunto.",
    "Correo: `email_integration_status` reporta la casilla conectada para lectura y los envíos salientes de Andromeda; nunca expone tokens ni cuerpos de terceros.",
    "WhatsApp a clientes: `whatsapp_notices` (consentimientos, borradores, enviados) y `whatsapp_prepare` (registrar/revocar consentimiento, preparar, editar o descartar borradores). NINGUNA herramienta aprueba ni envía mensajes: eso solo ocurre en la pantalla Avisos WhatsApp, uno por uno.",
    "Permisos: `get_capabilities` verifica la sesión, el permiso y la disponibilidad efectiva de cada acción. Gestionar exige que el usuario lo active él mismo desde su sesión en Andromeda → Configuración → Conexiones, y puede revocarlo en cualquier momento; ningún argumento de herramienta (confirm, user_id, client_id) lo sustituye, y la base de datos verifica el permiso en cada escritura.",
    "Escritura (solo con instrucción explícita del usuario y permiso de gestión): `add_note`, `add_hearing`, `update_work_item`, `manage_deadline`, `manage_task`, `create_work_item`, `create_peticion` (petición + fecha de presentación + términos en una sola operación; sin fecha queda FECHA_PRESENTACION_PENDIENTE), `change_work_item_lifecycle` (archivar, papelera recuperable 10 días, restaurar), `move_work_item_stage` y `resolve_stage_suggestion` (con `list_workflow_stages` y `list_stage_suggestions`), `resolve_alert` (alertas de `list_alerts`) y `set_notification_state` (notificaciones de `list_notifications`), `resolve_email_question` y `add_email_association`, `resolve_detected_process`, `create_client` y `update_client` (directorio de clientes: nunca fusiona por nombre; identificación repetida devuelve conflicto). Cada escritura exige `idempotency_key`; las de etapa y ciclo de vida exigen `expected_updated_at`. Nunca hay borrado definitivo, cambio de radicado o tipo de proceso, administración de cuentas ni envío de correos; asociar un correo o descartar una alerta nunca cambia etapas ni cumple términos.",
    "Continuación de creación: `assign_work_item_radicado` asigna exactamente 23 dígitos solo a un asunto propio ACTIVE sin radicado, con revisión e idempotencia; nunca reemplaza identidad ni restaura. Guarda sin consultar proveedores; sincronización programada pendiente. `get_capabilities` verifica disponibilidad de ejecución y permiso de gestión en tiempo de consulta. `list_notifications` filtra descartadas antes de paginar con next_cursor/has_more.",
    "Novedades: `list_updates` entrega actuaciones, estados y ciclo de vida por revisión; deduplica por dedupe_key y consulta freshness. freshness.issues identifica asuntos con fallos o sin consulta reciente incluso sin eventos; continúa su página con `list_freshness_issues` y next_after. reconcile_since relee filas actuales hasta 400 días, no historial completo ni purgas; commits tardíos de más de 15 minutos pueden perderse.",
    "Correcciones explícitas: add_hearing con hearing_id conserva identidad, exige revisión, motivo y clave; update_work_item admite authority_email:null y, separadamente, reclasificación workflow_type+stage con catálogo vivo, motivo y revisión. get_capabilities.correction_availability determina si esas variantes están liberadas; nunca presumas disponibilidad de una variante por el permiso de la herramienta base. La remisión no acredita terminación. No inventes plazos ni cifras: si una herramienta no devuelve el dato, dilo explícitamente.",
    "Protocolo de alta tras radicación (no es un disparador automático: Andromeda no observa otros conectores; tú debes ejecutarlo): solo cuando TÚ hayas hecho y confirmado una presentación externa REAL de una petición, demanda o tutela NUEVA por correo oficial o portal, o el abogado asumió apoderamiento en un asunto NUEVO, (1) conserva fecha y soporte de salida; (2) busca el asunto con `search`/`list_work_items`/`get_work_item` por radicado o referencia, cliente y autoridad (incluida la papelera); (3) si existe, NO crees otro: la correspondencia se vincula con los mecanismos de correo existentes (`list_email_links`, `add_email_association`); (4) si no existe, crea UNA ficha con `create_peticion` (fecha de presentación, soporte y componentes; 10/15/30 días hábiles sin exigir acuse) o `create_work_item` (judicial o administrativo); (5) relee con `get_work_item` y verifica ficha, términos y tareas; (6) informa al abogado ambas gestiones: la presentación externa y el registro en Andromeda. Nunca trates un borrador, un poder o un escrito no presentado como radicación; nunca crees una ficha por cada memorial, recurso, reiteración, respuesta o correo de un asunto existente. Si una notificación recibida confirma vinculación a un procedimiento no registrado, crea una sola ficha de ese asunto. Clasificación: CPACA = proceso judicial contencioso (SAMAI); GOV_PROCEDURE = trámite ante la administración, incluido sancionatorio de tránsito o ambiental (seguimiento por correo/manual, sin SAMAI); una superintendencia en función jurisdiccional no es sancionatorio. Presentar una demanda no inicia el término de contestación sin notificación o traslado acreditado.",
    "Las herramientas `atenia_*` son exclusivas de administradores de la plataforma; para cualquier otro usuario devuelven un rechazo limpio. No las ofrezcas si el usuario no es administrador.",
  ].join(" "),
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    // Public, non-secret revision marker served by the unauthenticated
    // protected-resource metadata, so a deploy can be confirmed from outside.
    resourceDocumentation: "https://andromeda.legal/connect-ai/mcp-rev-0-8-2",
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
    createClient,
    updateClient,
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
    createPeticion,
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
    listFreshnessIssues,
    listEmailQuestions,
    assignWorkItemRadicado,
    ateniaHealthOverview,
    ateniaProviderStatus,
    ateniaRecentIncidents,
  ],
});
