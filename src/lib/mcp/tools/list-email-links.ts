import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult, workItemTitle } from "../shared";

export default defineTool({
  name: "list_email_links",
  title: "Correos vinculados al expediente",
  description:
    "Lists the email metadata linked to one matter (work_item_email_links): subject, direction, sender, date, evidence type, how it was matched, confidence, attachments and the Outlook web link. Read-only; Andromeda never stores email bodies.",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("UUID del asunto."),
    radicado: z.string().trim().optional().describe("Radicado del asunto (alternativa al UUID)."),
    status: z
      .enum(["CONFIRMED", "SUGGESTED", "DISMISSED", "ALL"])
      .optional()
      .describe("Estado del vínculo. Default: CONFIRMED + SUGGESTED."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de filas (default 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ work_item_id, radicado, status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const resolved = await resolveWorkItem(sb, { id: work_item_id, radicado });
    if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
    const item = resolved.item;

    let q = sb
      .from("work_item_email_links")
      .select(
        "id, subject, direction, sender, recipients, received_at, evidence_type, matched_by, matched_value, confidence, has_attachments, web_link, link_status",
      )
      .eq("work_item_id", item.id as string)
      .order("received_at", { ascending: false })
      .limit(limit ?? 30);

    if (!status) q = q.in("link_status", ["CONFIRMED", "SUGGESTED"]);
    else if (status !== "ALL") q = q.eq("link_status", status);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    const links = data ?? [];
    const titulo = workItemTitle(item);
    return textResult(
      `${links.length} correo(s) vinculado(s) a ${titulo} (${item.radicado ?? "sin radicado"}).`,
      {
        work_item: { id: item.id, radicado: item.radicado ?? null, titulo },
        total: links.length,
        links,
        nota: "Solo metadatos. Andromeda nunca almacena el cuerpo de los correos.",
      },
    );
  },
});
