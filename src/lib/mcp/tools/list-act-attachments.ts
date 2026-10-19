import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";
import { getActAttachments } from "../act-attachments-core";

export default defineTool({
  name: "list_act_attachments",
  title: "Anexos de una actuación",
  description:
    "Attachment inventory for a caller-owned act: announced count (null when unknown), stored links, header checks, full-file recovery and attribution reported separately. This tool only checks up to 1024 bytes; cabeceras_verificadas does NOT mean a complete, readable or correctly attributed PDF. verificados remains zero and recuperacion_completa false after header checks alone. Missing annexes are not recovered. Returned links with cabecera_pdf are unverified complete files. Act and matter use caller RLS; optional matter must match. Read-only; no court fetch, file creation or permission changes.",
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
    if (r.ok === false) return errorResult(r.error);
    return textResult(`Anexos: ${r.data.estado} — ${r.data.causa}`, r.data);
  },
});
