import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

/**
 * Data-model catalogue for `query_table`.
 *
 * This is the single source of truth for which tables MCP may read directly.
 * Anything not listed here is simply not queryable over MCP — and even for the
 * listed ones, every read still runs with the caller's own token, so Postgres
 * RLS decides which rows come back. No service role, ever.
 */
export const READABLE_TABLES: Record<string, { que_es: string; columnas_clave: string[] }> = {
  work_items: {
    que_es: "Entidad canónica: un asunto/expediente.",
    columnas_clave: ["id", "radicado", "title", "workflow_type", "stage", "status", "authority_name", "client_id", "demandantes", "demandados", "monitoring_enabled", "last_action_date", "created_at"],
  },
  work_item_acts: {
    que_es: "Actuaciones reportadas por los proveedores judiciales.",
    columnas_clave: ["id", "work_item_id", "act_date", "title", "description", "source", "detected_at"],
  },
  work_item_publicaciones: {
    que_es: "Estados electrónicos / publicaciones.",
    columnas_clave: ["id", "work_item_id", "estado_numero", "fecha_fijacion", "detected_at", "descripcion", "documento_url"],
  },
  work_item_deadlines: {
    que_es: "Términos procesales. PENDING_REVIEW y los estados históricos NO son obligaciones vigentes.",
    columnas_clave: ["id", "work_item_id", "deadline_type", "label", "trigger_date", "deadline_date", "business_days_count", "status", "notes"],
  },
  work_item_tasks: {
    que_es: "Tareas del despacho asociadas a un asunto.",
    columnas_clave: ["id", "work_item_id", "title", "description", "status", "priority", "due_date", "completed_at"],
  },
  work_item_email_links: {
    que_es: "Metadatos de correos vinculados a un asunto (nunca el cuerpo).",
    columnas_clave: ["id", "work_item_id", "subject", "direction", "sender", "received_at", "link_status", "confidence"],
  },
  hearings: {
    que_es: "Audiencias programadas y celebradas.",
    columnas_clave: ["id", "work_item_id", "hearing_type_id", "scheduled_at", "status", "location", "notes"],
  },
  clients: {
    que_es: "Clientes del despacho.",
    columnas_clave: ["id", "name", "id_number", "email", "city", "notes", "created_at"],
  },
  alert_instances: {
    que_es: "Alertas generadas por el monitoreo.",
    columnas_clave: ["id", "work_item_id", "alert_type", "severity", "title", "message", "status", "created_at"],
  },
  detected_processes: {
    que_es: "Radicados detectados en el buzón que aún no son asunto.",
    columnas_clave: ["id", "radicado", "source", "status", "detected_at"],
  },
  client_wa_consent: {
    que_es: "Consentimientos de WhatsApp por cliente (revocables).",
    columnas_clave: ["id", "client_id", "phone_e164", "consent_method", "granted_at", "revoked_at"],
  },
  client_wa_drafts: {
    que_es: "Borradores de avisos de WhatsApp en espera de aprobación del abogado.",
    columnas_clave: ["id", "client_id", "work_item_id", "fact_date", "fact_text", "body_text", "status", "expires_at"],
  },
  client_wa_sends: {
    que_es: "Bitácora de avisos de WhatsApp efectivamente enviados.",
    columnas_clave: ["id", "client_id", "work_item_id", "phone_e164", "body_text", "sent_at", "delivery_status"],
  },
  email_outbox: {
    que_es: "Correos que Andromeda envía (alertas, digest). Sin cuerpos de terceros.",
    columnas_clave: ["id", "to_email", "subject", "status", "created_at", "sent_at", "error", "work_item_id"],
  },
  generated_documents: {
    que_es: "Documentos generados por la plataforma.",
    columnas_clave: ["id", "work_item_id", "client_id", "document_type", "status", "created_at"],
  },
  contracts: {
    que_es: "Contratos con clientes.",
    columnas_clave: ["id", "client_id", "status", "start_date", "end_date", "created_at"],
  },
};

export default defineTool({
  name: "describe_data_model",
  title: "Modelo de datos consultable",
  description:
    "Lists the Andromeda tables that `query_table` can read, what each one holds, its key columns, and how many rows the caller can actually see under RLS. Start here before composing a `query_table` call.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const names = Object.keys(READABLE_TABLES);
    const counts = await Promise.all(
      names.map(async (t) => {
        const { count, error } = await sb.from(t).select("id", { count: "exact", head: true });
        return [t, error ? null : (count ?? 0)] as [string, number | null];
      }),
    );
    const byName = new Map(counts);

    return textResult(
      `${names.length} tablas consultables. Los conteos son lo que TU usuario puede ver (RLS aplicado).`,
      {
        tablas: names.map((t) => ({
          tabla: t,
          ...READABLE_TABLES[t],
          filas_visibles: byName.get(t) ?? null,
        })),
        nota: "Toda lectura usa tu propio token: nunca se usa una llave de servicio ni se saltan las políticas RLS.",
      },
    );
  },
});
