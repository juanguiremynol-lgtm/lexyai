import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, resolveWorkItem, rpcErrorText, sbForUser, textResult, workItemTitle } from "../shared";

/**
 * Editable surface of a matter over MCP.
 *
 * What is intentionally NOT here, and why:
 *  - `radicado` / `workflow_type` / `stage`: identity, routing and procedural
 *    stage are governed by the classification and preclusion rules in the DB.
 *    An assistant must not move a matter through its procedural life.
 *  - deletion / lifecycle_state: handled only by change_work_item_lifecycle (recoverable; no purge).
 */
export default defineTool({
  name: "update_work_item",
  title: "Editar datos de un asunto",
  description:
    "Updates the descriptive fields of a matter: title, parties, court data, links, client, flags and monitoring switches. Monitoring is paused/resumed through the explicit, audited user suspension (a reason is required to pause). It can NEVER change the radicado, the workflow type, the procedural stage, or delete/archive the matter.",
  inputSchema: {
    radicado: z.string().trim().optional().describe("Radicado del asunto (cualquier forma)."),
    id: z.string().uuid().optional().describe("UUID del asunto."),
    title: z.string().trim().max(300).optional().describe("Carátula / título del asunto."),
    description: z.string().trim().max(4000).optional(),
    demandantes: z.string().trim().max(1000).optional(),
    demandados: z.string().trim().max(1000).optional(),
    authority_name: z.string().trim().max(300).optional().describe("Nombre del despacho."),
    authority_email: z.string().trim().email().max(200).nullable().optional().describe("Correo del despacho; null elimina explícitamente un correo desactualizado, sin inventar reemplazo."),
    authority_city: z.string().trim().max(120).optional(),
    expediente_url: z.string().trim().url().max(2000).optional(),
    client_id: z.string().uuid().optional().describe("Cliente al que se vincula el asunto."),
    is_flagged: z.boolean().optional().describe("Marcar/desmarcar como destacado."),
    monitoring_enabled: z
      .boolean()
      .optional()
      .describe("Pausar (false) o reanudar (true) el monitoreo automático. Usa la suspensión explícita del usuario (auditada); no se revierte sola."),
    monitoring_off_reason: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .optional()
      .describe("Motivo indicado por el usuario al pausar el monitoreo (obligatorio si monitoring_enabled=false)."),
    email_linking_enabled: z.boolean().optional().describe("Activar o desactivar la vinculación de correos."),
    idempotency_key: z.string().min(8).max(200).optional().describe(IDEMPOTENCY_KEY_DESCRIPTION),
    workflow_type: z.string().trim().min(2).optional().describe("Reclasificación explícita, solo con stage, expected_updated_at, reason e idempotency_key; no se combina con otros cambios."),
    stage: z.string().trim().min(1).optional().describe("Etapa de destino validada contra el catálogo vivo del tipo de proceso."),
    expected_updated_at: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().min(5).max(2000).optional().describe("Motivo y evidencia de la reclasificación."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);

    const resolved = await resolveWorkItem(sb, { id: args.id, radicado: args.radicado });
    const item = resolved.item;
    if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");

    if (args.workflow_type !== undefined || args.stage !== undefined) {
      const allowed = new Set(["id", "radicado", "workflow_type", "stage", "expected_updated_at", "reason", "idempotency_key"]);
      if (Object.entries(args).some(([k, v]) => v !== undefined && !allowed.has(k))) return errorResult("No combines reclasificación con edición de datos o monitoreo.");
      if (!args.workflow_type || !args.stage || !args.expected_updated_at || !args.reason || !args.idempotency_key) return errorResult("Reclasificar requiere tipo, etapa, revisión, motivo e idempotency_key.");
      const { data, error } = await sb.rpc("mcp_reclassify_work_item", { p_work_item_id: item.id as string, p_workflow_type: args.workflow_type, p_stage: args.stage, p_expected_updated_at: args.expected_updated_at, p_reason: args.reason, p_idempotency_key: args.idempotency_key });
      if (error) return errorResult(rpcErrorText(error));
      return textResult("Asunto reclasificado; actuaciones, documentos, notas e historial se conservan.", data as Record<string, unknown>);
    }

    const EDITABLE = [
      "title", "description", "demandantes", "demandados", "authority_name", "authority_email",
      "authority_city", "expediente_url", "client_id", "is_flagged", "email_linking_enabled",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      const v = (args as Record<string, unknown>)[key];
      if (v !== undefined) patch[key] = v;
    }
    const monitoringChange = args.monitoring_enabled;
    if (monitoringChange === false && !args.monitoring_off_reason) {
      return errorResult("Para pausar el monitoreo indica monitoring_off_reason con el motivo que dio el usuario.");
    }
    if (Object.keys(patch).length === 0 && monitoringChange === undefined) {
      return errorResult("No indicaste ningún campo para cambiar.");
    }

    // One transaction validates the client before changes and retains canonical monitoring RPCs.
    const { data: result, error } = await sb.rpc("mcp_update_work_item", {
      p_work_item_id: item.id as string,
      p_patch: patch,
      p_monitoring_enabled: monitoringChange ?? null,
      p_monitoring_off_reason: args.monitoring_off_reason ?? null,
      p_idempotency_key: args.idempotency_key ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    const committed = result as Record<string, unknown> | null;
    const data = committed?.work_item as Record<string, unknown> | undefined;
    if (!data) return errorResult("No se pudo confirmar el asunto tras el cambio.");
    if (monitoringChange !== undefined) patch.monitoring_enabled = data.monitoring_enabled;

    return textResult(
      `${resolved.note ? `${resolved.note}\n` : ""}Asunto ${item.radicado ?? item.id} actualizado (${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}).`,
      {
        work_item: data,
        titulo: workItemTitle((data ?? item) as Record<string, unknown>),
        cambios: patch,
        idempotency_key: committed?.idempotency_key ?? null,
        replayed: committed?.replayed ?? false,
        nota: "Radicado, tipo de proceso y etapa procesal no se modifican por esta vía.",
      },
    );
  },
});
