import { defineTool } from "@lovable.dev/mcp-js";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";
import type { Database } from "@/integrations/supabase/types";

/**
 * Data-model catalogue for `query_table`.
 *
 * This is the single source of truth for which tables MCP may read directly.
 * Anything not listed here is simply not queryable over MCP — and even for the
 * listed ones, every read still runs with the caller's own token, so Postgres
 * RLS decides which rows come back. No service role, ever.
 *
 * Column names are checked against the generated database types at compile
 * time (`entry()` below): a column that does not exist in the real schema
 * fails the typecheck instead of shipping a catalogue that produces invalid
 * queries. The catalogue previously advertised columns such as
 * `work_item_acts.title` and the legacy empty `hearings` table; both are gone.
 */
type PublicTables = Database["public"]["Tables"];
type TableName = keyof PublicTables & string;

interface CatalogEntry {
  que_es: string;
  columnas_clave: string[];
}

/** Compile-time guard: every declared column must exist on that table's Row. */
function entry<K extends TableName>(
  _table: K,
  que_es: string,
  columnas_clave: (keyof PublicTables[K]["Row"] & string)[],
): CatalogEntry {
  return { que_es, columnas_clave };
}

export const READABLE_TABLES: Record<string, CatalogEntry> = {
  work_items: entry("work_items", "Entidad canónica: un asunto/expediente.", [
    "id", "radicado", "title", "workflow_type", "stage", "status", "authority_name",
    "client_id", "demandantes", "demandados", "monitoring_enabled", "last_action_date", "created_at",
  ]),
  work_item_acts: entry("work_item_acts", "Actuaciones reportadas por los proveedores judiciales.", [
    "id", "work_item_id", "act_date", "act_type", "description", "event_summary",
    "despacho", "source", "detected_at", "is_archived",
  ]),
  work_item_publicaciones: entry("work_item_publicaciones", "Estados electrónicos / publicaciones.", [
    "id", "work_item_id", "title", "annotation", "fecha_fijacion", "fecha_desfijacion",
    "detected_at", "despacho", "tipo_publicacion", "pdf_url", "source", "is_archived",
  ]),
  work_item_deadlines: entry(
    "work_item_deadlines",
    "Términos procesales. REQUIERE_REVISION_MANUAL y los estados históricos NO son obligaciones vigentes.",
    ["id", "work_item_id", "deadline_type", "label", "trigger_date", "deadline_date", "business_days_count", "status", "term_class", "notes"],
  ),
  work_item_tasks: entry("work_item_tasks", "Tareas del despacho asociadas a un asunto.", [
    "id", "work_item_id", "title", "description", "status", "priority", "due_date", "completed_at",
  ]),
  work_item_email_links: entry("work_item_email_links", "Metadatos de correos vinculados a un asunto (nunca el cuerpo).", [
    "id", "work_item_id", "subject", "direction", "sender", "received_at", "link_status", "confidence",
  ]),
  work_item_hearings: entry(
    "work_item_hearings",
    "Audiencias — tabla canónica. Con scheduled_at nulo la fila es un marcador detectado, no una audiencia con fecha.",
    ["id", "work_item_id", "hearing_type_id", "custom_name", "scheduled_at", "occurred_at", "status", "modality", "location", "meeting_link"],
  ),
  clients: entry("clients", "Clientes del despacho.", [
    "id", "name", "id_number", "email", "city", "notes", "created_at",
  ]),
  alert_instances: entry("alert_instances", "Alertas generadas por el monitoreo. El asunto va en entity_id cuando entity_type lo indica.", [
    "id", "entity_type", "entity_id", "alert_type", "alert_source", "severity", "title", "message", "status", "created_at",
  ]),
  detected_processes: entry("detected_processes", "Radicados detectados en el buzón que aún no son asunto.", [
    "id", "radicado", "subject", "sender", "status", "first_seen_at", "last_seen_at", "created_work_item_id",
  ]),
  client_wa_consent: entry("client_wa_consent", "Consentimientos de WhatsApp por cliente (revocables).", [
    "id", "client_id", "phone_e164", "consent_method", "granted_at", "revoked_at",
  ]),
  client_wa_drafts: entry("client_wa_drafts", "Borradores de avisos de WhatsApp en espera de aprobación del abogado.", [
    "id", "client_id", "work_item_id", "fact_date", "fact_text", "body_text", "status", "expires_at",
  ]),
  client_wa_sends: entry("client_wa_sends", "Bitácora de avisos de WhatsApp efectivamente enviados.", [
    "id", "client_id", "work_item_id", "phone_e164", "body_text", "sent_at", "delivery_status",
  ]),
  email_outbox: entry("email_outbox", "Correos que Andromeda envía (alertas, digest). Sin cuerpos de terceros.", [
    "id", "to_email", "subject", "status", "created_at", "sent_at", "error", "work_item_id",
  ]),
  generated_documents: entry("generated_documents", "Documentos generados por la plataforma.", [
    "id", "work_item_id", "document_type", "title", "status", "created_at", "finalized_at",
  ]),
  contracts: entry("contracts", "Contratos con clientes.", [
    "id", "client_id", "service_description", "contract_value", "contract_date", "status", "created_at",
  ]),
};

export default defineTool({
  name: "describe_data_model",
  title: "Modelo de datos consultable",
  description:
    "Lists the Andromeda tables that `query_table` can read, what each one holds, its key columns (validated against the real schema), and how many rows the caller can actually see under RLS. Start here before composing a `query_table` call.",
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
