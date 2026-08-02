import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "get_document_url",
  title: "Enlace del documento de una publicación",
  description:
    "Returns a short-lived download URL for the PDF attached to a publicación (estado electrónico) of one of the caller's matters. It never generates new documents; it only exposes an existing attachment under the established access policy.",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("UUID del asunto."),
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Radicado en cualquier forma: 23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia."),
    document_id: z.string().uuid().describe("UUID de la publicación (estado) cuyo PDF se solicita."),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async ({ work_item_id, radicado, document_id }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const resolved = await resolveWorkItem(sb, { id: work_item_id, radicado });
    if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
    const itemId = resolved.item.id as string;

    // RLS-scoped read: confirms the publicación belongs to a matter the caller
    // can see, and that it belongs to the matter they named.
    const { data: pub, error } = await sb
      .from("work_item_publicaciones")
      .select("id, work_item_id, title, tipo_publicacion, fecha_fijacion, pdf_url, pdf_available")
      .eq("id", document_id)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!pub) return errorResult("Documento no encontrado (o no pertenece a tu cuenta).");
    if ((pub as { work_item_id: string }).work_item_id !== itemId) {
      return errorResult("El documento no pertenece al asunto indicado.");
    }

    const publicUrl = (pub as { pdf_url?: string | null }).pdf_url ?? null;
    if (publicUrl && /^https?:\/\//i.test(publicUrl) && /storage\.googleapis\.com/i.test(publicUrl)) {
      return textResult(`Enlace público del documento de ${(pub as { title?: string }).title ?? "la publicación"}.`, {
        resolucion: resolved.note ?? null, document_id, work_item_id: itemId, url: publicUrl, source: "public",
      });
    }

    // Signed URL path — delegated to the hardened edge function, which
    // re-validates the caller's organization membership server-side.
    const base = process.env.SUPABASE_URL!;
    const res = await fetch(`${base}/functions/v1/get-estado-attachment-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.getToken()}`,
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({ publicacion_id: document_id }),
    });
    const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
    if (!res.ok || !payload.url) {
      return errorResult(
        payload.error === "no_pdf_available"
          ? "Esta publicación no tiene PDF disponible."
          : `No se pudo obtener el documento: ${payload.error ?? res.status}`,
      );
    }

    return textResult("Enlace temporal generado (válido ~10 minutos).", {
      resolucion: resolved.note ?? null, document_id, work_item_id: itemId, url: payload.url, source: "signed", expires_in_seconds: 600,
    });
  },
});