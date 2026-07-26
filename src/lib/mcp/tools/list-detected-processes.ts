import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "list_detected_processes",
  title: "Procesos detectados en el correo",
  description:
    "Lists judicial case numbers (radicados) found in the caller's mailbox that do NOT exist in their Andromeda portfolio yet (detected_processes queue). Use it to help the lawyer triage which ones deserve a matter. Read-only: creating the matter always happens in the app.",
  inputSchema: {
    status: z
      .enum(["PENDING", "DISMISSED", "CREATED", "ALL"])
      .optional()
      .describe("Estado de la detección. Default: PENDING."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    let q = sb
      .from("detected_processes")
      .select(
        "id, radicado, subject, sender, web_link, partes_inferidas, despacho_inferido, workflow_inferido, ciudad_inferida, first_seen_at, last_seen_at, occurrences, status",
      )
      .order("last_seen_at", { ascending: false })
      .limit(limit ?? 50);
    const wanted = status ?? "PENDING";
    if (wanted !== "ALL") q = q.eq("status", wanted);

    const { data, error } = await q;
    if (error) return errorResult(error.message);
    const rows = data ?? [];
    return textResult(
      `${rows.length} proceso(s) detectado(s) en el correo con estado ${wanted}.`,
      {
        total: rows.length,
        status: wanted,
        procesos: rows,
        nota: "Andromeda nunca crea expedientes automáticamente: el abogado decide en la app.",
      },
    );
  },
});
