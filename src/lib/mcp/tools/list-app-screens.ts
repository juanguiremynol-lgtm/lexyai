import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requireAuth, textResult } from "../shared";

/**
 * "Ver el frontend" desde el asistente.
 *
 * MCP cannot render the UI, but it CAN tell the assistant exactly which screen
 * answers a question and give the lawyer a deep link he can click. Every path
 * below is a real route registered in src/App.tsx — keep them in sync.
 */
const BASE = "https://andromeda.legal";

const SCREENS: { path: string; nombre: string; para: string }[] = [
  { path: "/app/dashboard", nombre: "Tablero", para: "Resumen del día: novedades, tableros por tipo de proceso y pendientes." },
  { path: "/app/estados-hoy", nombre: "Estados de hoy", para: "Estados electrónicos fijados o detectados hoy, incluidos los programados a futuro." },
  { path: "/app/actuaciones-hoy", nombre: "Actuaciones de hoy", para: "Actuaciones leídas hoy por los proveedores judiciales." },
  { path: "/app/processes", nombre: "Procesos", para: "Listado completo de asuntos con filtros por tipo, etapa y cliente." },
  { path: "/app/work-items/:id", nombre: "Detalle del asunto", para: "Actuaciones, estados, términos, audiencias, documentos, partes y notas de un asunto." },
  { path: "/app/radicados/:radicado", nombre: "Detalle por radicado", para: "Mismo detalle, abierto directamente por número de radicado." },
  { path: "/app/clients", nombre: "Clientes", para: "Clientes, sus procesos, contratos y documentos." },
  { path: "/app/tasks", nombre: "Tareas", para: "Tareas del despacho con vencimiento y responsable." },
  { path: "/app/alerts", nombre: "Alertas", para: "Alertas sin resolver del monitoreo judicial." },
  { path: "/app/hearings", nombre: "Audiencias", para: "Agenda de audiencias y sus insumos." },
  { path: "/app/email", nombre: "Correo", para: "Buzón vinculado: correos asociados a expedientes." },
  { path: "/app/procesos-detectados", nombre: "Procesos detectados", para: "Radicados hallados en el buzón que aún no existen como asunto." },
  { path: "/app/avisos-whatsapp", nombre: "Avisos WhatsApp", para: "Cola de aprobación de avisos a clientes, consentimientos y envíos." },
  { path: "/app/documentos-legales", nombre: "Documentos legales", para: "Contratos, firmas y plantillas." },
  { path: "/app/documents", nombre: "Buscador de documentos", para: "Búsqueda transversal de documentos." },
  { path: "/app/cpaca", nombre: "CPACA", para: "Tablero de procesos contencioso-administrativos." },
  { path: "/app/process-status", nombre: "Estado del monitoreo", para: "Cobertura y salud de los proveedores por asunto." },
  { path: "/app/sistema", nombre: "Salud del sistema", para: "Diagnóstico de sincronizaciones y proveedores." },
  { path: "/app/utilities", nombre: "Utilidades", para: "Calculadora de términos, festivos y herramientas sueltas." },
  { path: "/app/settings", nombre: "Configuración", para: "Perfil, organización, plan y facturación." },
  { path: "/app/settings/connections", nombre: "Conexiones", para: "Correo (Outlook), proveedores y asistentes conectados." },
  { path: "/app/connect", nombre: "Conectar asistente", para: "Instrucciones para conectar ChatGPT, Claude u otro cliente MCP." },
  { path: "/app/new-process", nombre: "Nuevo proceso", para: "Alta de un asunto nuevo y su inscripción al monitoreo." },
];

export default defineTool({
  name: "list_app_screens",
  title: "Pantallas de Andromeda y enlaces directos",
  description:
    "Maps every Andromeda screen to what it shows and returns a clickable deep link. Use it to tell the user exactly where in the app to look, or to build a link to a specific matter (/app/radicados/<radicado>). Read-only; it does not render the UI.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    return textResult(
      `${SCREENS.length} pantallas. Para abrir un asunto concreto usa ${BASE}/app/radicados/<radicado>.`,
      {
        base_url: BASE,
        pantallas: SCREENS.map((s) => ({ ...s, url: `${BASE}${s.path}` })),
        nota: "Los segmentos :id y :radicado se reemplazan por el UUID del asunto o su radicado de 23 dígitos.",
      },
    );
  },
});
