import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";
import {
  EMAIL_HEALTH_POLICY,
  emailConnectionHealth,
  emailHealthReason,
  isExternalRevocation,
} from "../../email-connection-health";

/**
 * Email plumbing, from the lawyer's point of view.
 *
 * Two different things share the word "correo": the mailbox Andromeda READS
 * (Outlook, stored in `user_email_connections` — the SAME table the web app
 * reads via use-email-connection.ts) and the mail Andromeda SENDS (alerts,
 * digest, document delivery — `email_outbox`). Both are reported here, and
 * neither exposes a secret: token ciphertext columns are never selected.
 *
 * Health is NOT derived here: it comes from `lib/email-connection-health`,
 * the one policy the screen, the digest and the SQL detector also apply, so
 * this tool cannot report ACTIVA while the digest reports a dead channel.
 */


export default defineTool({
  name: "email_integration_status",
  title: "Estado de la integración de correo",
  description:
    "Reports the Outlook mailbox connection Andromeda reads from (provider, account, health, last sync, last token renewal and its outcome, failure code — never tokens) and the recent outbound mail Andromeda sent (alerts, digest, document delivery) with delivery state and failures. Reads `user_email_connections`, the same source as the web app.",
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

    const { data: rawConns, error: connErr } = await sb
      .from("user_email_connections")
      .select(
        "id, provider, ms_account_email, status, can_send, connected_at, last_sync_at, token_expires_at, last_refresh_at, last_refresh_outcome, refresh_failure_count, failure_code, failure_detail, revoked_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(20);
    if (connErr) return errorResult(connErr.message);

    const conexiones = (rawConns ?? []).map((c) => {
      const row = c as Record<string, unknown>;
      return {
        ...row,
        salud: deriveHealth(row),
        nota_token:
          "token_expires_at es el vencimiento del access token de Microsoft (~1 hora); se renueva solo. No indica que haya que reconectar.",
      };
    });

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

    const activas = conexiones.filter((c) => c.salud === "ACTIVA").length;
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
