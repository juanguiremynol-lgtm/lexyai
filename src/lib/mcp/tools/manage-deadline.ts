import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  callerOrganizationId,
  errorResult,
  requireWriteScope,
  resolveWorkItem,
  sbForUser,
  textResult,
} from "../shared";

/**
 * Manual deadline management.
 *
 * The lawyer's own term, recorded because he says so. This tool NEVER computes
 * a date: `deadline_date` is whatever he states. The automatic term engine and
 * its provenance rules live in the database and are untouched here — anything
 * created through MCP is stamped MANUAL_MCP in calculation_meta so it can
 * always be told apart from an engine-derived term.
 */
const CLOSEABLE = ["FULFILLED", "CANCELLED", "DISMISSED"] as const;

export default defineTool({
  name: "manage_deadline",
  title: "Crear, editar o cerrar un término",
  description:
    "Creates a manual procedural deadline on a matter, edits its label/date/notes, or closes it as FULFILLED, CANCELLED or DISMISSED. It never computes a date by itself — the date given by the user is stored verbatim and marked as manual.",
  inputSchema: {
    action: z.enum(["create", "update", "close"]).describe("Qué hacer con el término."),
    deadline_id: z.string().uuid().optional().describe("Requerido para update y close."),
    radicado: z.string().trim().optional().describe("Asunto del término (para create)."),
    work_item_id: z.string().uuid().optional().describe("UUID del asunto (para create)."),
    deadline_type: z.string().trim().max(80).optional().describe("Tipo, p. ej. CONTESTACION_DEMANDA. Default: MANUAL."),
    label: z.string().trim().max(200).optional().describe("Nombre visible del término."),
    description: z.string().trim().max(2000).optional(),
    trigger_event: z.string().trim().max(200).optional().describe("Hecho que lo origina, tal como lo describe el usuario."),
    trigger_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha del hecho (YYYY-MM-DD)."),
    deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha de vencimiento indicada por el usuario (YYYY-MM-DD)."),
    business_days_count: z.number().int().min(0).max(365).optional().describe("Días hábiles del término, si el usuario los indica."),
    notes: z.string().trim().max(2000).optional(),
    close_as: z.enum(CLOSEABLE).optional().describe("Estado de cierre (para close)."),
    close_reason: z.string().trim().max(500).optional().describe("Motivo del cierre."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);
    const userId = ctx.getUserId?.();
    if (!userId) return errorResult("No se pudo identificar al usuario del token.");

    if (args.action === "create") {
      const resolved = await resolveWorkItem(sb, { id: args.work_item_id, radicado: args.radicado });
      const item = resolved.item;
      if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      if (!args.deadline_date) return errorResult("Indica la fecha de vencimiento (deadline_date, YYYY-MM-DD).");
      if (!args.label) return errorResult("Indica el nombre del término (label).");

      const orgId = await callerOrganizationId(sb, userId);
      const { data, error } = await sb
        .from("work_item_deadlines")
        .insert({
          owner_id: userId,
          organization_id: orgId,
          work_item_id: item.id as string,
          deadline_type: args.deadline_type?.toUpperCase() ?? "MANUAL",
          label: args.label,
          description: args.description ?? null,
          trigger_event: args.trigger_event ?? null,
          trigger_date: args.trigger_date ?? null,
          deadline_date: args.deadline_date,
          business_days_count: args.business_days_count ?? null,
          status: "PENDING",
          notes: args.notes ?? null,
          calculation_meta: {
            origin: "MANUAL_MCP",
            declared_by: userId,
            declared_at: new Date().toISOString(),
            note: "Fecha indicada por el usuario; no calculada por el motor de términos.",
          },
        })
        .select("id, work_item_id, deadline_type, label, trigger_date, deadline_date, status")
        .maybeSingle();
      if (error) return errorResult(error.message);

      return textResult(`Término creado para ${item.radicado ?? item.id}, vence el ${args.deadline_date}.`, {
        deadline: data,
        nota: "Registrado como manual (MANUAL_MCP): la fecha es la que indicó el usuario.",
      });
    }

    if (!args.deadline_id) return errorResult("Indica el deadline_id del término.");

    if (args.action === "close") {
      if (!args.close_as) return errorResult("Indica close_as: FULFILLED, CANCELLED o DISMISSED.");
      const patch: Record<string, unknown> = {
        status: args.close_as,
        closure_reason: args.close_reason ?? "Cerrado por el usuario vía asistente IA",
        updated_at: new Date().toISOString(),
      };
      if (args.close_as === "FULFILLED") patch.met_at = new Date().toISOString();
      const { data, error } = await sb
        .from("work_item_deadlines")
        .update(patch)
        .eq("id", args.deadline_id)
        .select("id, work_item_id, label, deadline_date, status, closure_reason")
        .maybeSingle();
      if (error) return errorResult(error.message);
      if (!data) return errorResult("Término no encontrado (o no pertenece a tu cuenta).");
      return textResult(`Término cerrado como ${args.close_as}.`, { deadline: data });
    }

    const patch: Record<string, unknown> = {};
    for (const k of ["label", "description", "trigger_event", "trigger_date", "deadline_date", "business_days_count", "notes"] as const) {
      const v = (args as Record<string, unknown>)[k];
      if (v !== undefined) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return errorResult("No indicaste ningún campo para cambiar.");
    patch.updated_at = new Date().toISOString();

    const { data, error } = await sb
      .from("work_item_deadlines")
      .update(patch)
      .eq("id", args.deadline_id)
      .select("id, work_item_id, label, trigger_date, deadline_date, business_days_count, status, notes")
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Término no encontrado (o no pertenece a tu cuenta).");
    return textResult(`Término actualizado (${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}).`, {
      deadline: data,
    });
  },
});
