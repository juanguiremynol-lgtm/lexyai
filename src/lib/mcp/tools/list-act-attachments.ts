import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";
import { getActAttachments } from "../act-attachments-core";

export default defineTool({
  name: "list_act_attachments",
  title: "Anexos de una actuación",
  description:
    "Attachment inventory of one actuación of the caller's matters: announced count, verified PDFs ('1 de 6'), missing count, and an explicit state (desconocido / sin_anexos / enlaces_sin_verificar / restringido / sesion_requerida / error / inaccesible / parcial / disponible) with its cause. Only `act_id` is required; the act and its matter are both resolved under the caller's RLS. If `work_item_id` or `radicado` is given it must be the act's matter. Links are returned only for Andromeda-bucket copies whose bytes were verified as PDF. Read-only; never fetches from the court, never invents files.",
  inputSchema: {
    act_id: z.string().uuid().describe("UUID de la actuación."),
    work_item_id: z.string().uuid().optional().describe("Opcional: UUID del asunto; debe ser el de la actuación."),
    radicado: z.string().trim().optional().describe("Opcional: radicado del asunto; debe ser el de la actuación."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ act_id, work_item_id, radicado }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const r = await getActAttachments({
      sb: sbForUser(ctx),
      resolveWorkItem,
      fetchImpl: fetch,
      act_id,
      work_item_id,
      radicado,
    });
    if (!r.ok) return errorResult(r.error);
    return textResult(`Anexos: ${r.data.estado} — ${r.data.causa}`, r.data);
  },
});
