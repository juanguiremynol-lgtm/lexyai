import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";
import { summarizeActAttachments } from "../../act-attachments-inventory";

export default defineTool({
  name: "list_act_attachments",
  title: "Anexos de una actuación",
  description:
    "Returns the attachment inventory of one actuación (CPNU/SAMAI) of the caller's matter: announced count, explicit state (no_consultado / restringido / sesion_requerida / error / disponible / sin_anexos) with its cause, and links ONLY for files Andromeda already holds. Read-only under the caller's RLS; never fetches from the court, never invents files, and a missing inventory is reported as no_consultado — never as 'sin anexos'.",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("UUID del asunto."),
    radicado: z.string().trim().optional().describe("Radicado en cualquier forma."),
    act_id: z.string().uuid().describe("UUID de la actuación."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, act_id }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const resolved = await resolveWorkItem(sb, { id: work_item_id, radicado });
    if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
    const itemId = resolved.item.id as string;

    const { data: act, error } = await sb
      .from("work_item_acts")
      .select("id, work_item_id, act_date, description, source, documentos, documentos_observados_en, raw_data")
      .eq("id", act_id)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!act) return errorResult("Actuación no encontrada (o no pertenece a tu cuenta).");
    if ((act as { work_item_id: string }).work_item_id !== itemId) {
      return errorResult("La actuación no pertenece al asunto indicado.");
    }
    const summary = summarizeActAttachments(act as never);
    return textResult(`Anexos: ${summary.estado} — ${summary.causa}`, {
      resolucion: resolved.note ?? null,
      work_item_id: itemId,
      act_id,
      act_date: (act as { act_date?: string }).act_date ?? null,
      source: (act as { source?: string }).source ?? null,
      ...summary,
    });
  },
});
