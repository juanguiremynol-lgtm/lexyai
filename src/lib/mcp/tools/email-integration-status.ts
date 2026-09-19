import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

/**
 * Email plumbing, from the lawyer's point of view.
 *
 * Two different things share the word "correo": the mailbox Andromeda READS
 * (Outlook, via `integrations`) and the mail Andromeda SENDS (alerts, digest,
 * document delivery — `email_outbox`). Both are reported here, and neither
 * exposes a secret: tokens and passwords are never selected.
 */
export default defineTool({
  name: "email_integration_status",
  title: "Estado de la integración de correo",
  description:
    "Reports the mailbox connection Andromeda reads from (provider, status, last sync, last error — never tokens) and the recent outbound mail Andromeda sent (alerts, digest, document delivery) with delivery state and failures.",
  inputSchema: {
    include_outbox: z.boolean().optional().describe("Incluir los envíos recientes (default true)."),
    outbox_status: z.enum(["PENDING", "SENT", "FAILED", "ALL"]).optional().describe("Filtrar los envíos. Default: ALL."),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo de envíos (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ include_outbox, outbox_status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const { data: integrations, error: intErr } = await sb
      .from("integrations")
      .select("id, provider, status, username, expires_at, last_sync_at, last_error, session_last_ok_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20);
    if (intErr) return errorResult(intErr.message);

    let outbox: Record<string, unknown>[] = [];
    if (include_outbox !== false) {
      let q = sb
        .from("email_outbox")
        .select("id, to_email, subject, status, created_at, sent_at, error, failure_type, work_item_id, trigger_reason, last_event_type")
        .order("created_at", { ascending: false })
        .limit(limit ?? 20);
      if (outbox_status && outbox_status !== "ALL") q = q.eq("status", outbox_status);
      const { data, error } = await q;
      if (error) return errorResult(error.message);
      outbox = (data ?? []) as Record<string, unknown>[];
    }

    const conexiones = (integrations ?? []) as Record<string, unknown>[];
    const activas = conexiones.filter((c) => String(c.status ?? "").toUpperCase() === "CONNECTED").length;
    const fallidos = outbox.filter((o) => String(o.status ?? "").toUpperCase() === "FAILED").length;

    return textResult(
      conexiones.length === 0
        ? "No hay ninguna casilla de correo conectada para lectura."
        : `${conexiones.length} conexión(es) de correo (${activas} activa(s)); ${outbox.length} envío(s) reciente(s), ${fallidos} fallido(s).`,
      {
        buzon_lectura: conexiones,
        envios_recientes: outbox,
        resumen: { conexiones: conexiones.length, activas, envios: outbox.length, fallidos },
        nota: "Nunca se exponen tokens, contraseñas ni cuerpos de correos de terceros.",
      },
    );
  },
});
