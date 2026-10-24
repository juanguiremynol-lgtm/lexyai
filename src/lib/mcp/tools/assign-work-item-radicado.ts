import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { normalizeRadicado } from "../../radicado-utils";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "assign_work_item_radicado",
  title: "Asignar radicado a un asunto sin radicación",
  description: "Assigns a normalized exactly 23-digit string once to an ACTIVE owned matter with empty radicado, preserving leading zeros, stage, workflow and history. Requires explicit user instruction, manage permission, expected revision and idempotency key. Rejects existing identity, archived/deleted matters, duplicates including trash and monitored plan cap. Saved with scheduled synchronization pending; never calls providers, restores a matter or purges it. User EXECUTE remains review-gated.",
  inputSchema: {
    work_item_id: z.string().uuid(),
    radicado: z.string().min(1).max(200).describe("23 dígitos, con o sin separadores. No admite bases parciales ni números."),
    expected_updated_at: z.string().datetime({ offset: true }).describe("Revisión exacta de get_work_item; una revisión antigua se rechaza."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const normalized = normalizeRadicado(args.radicado);
    if (!normalized.ok || !normalized.radicado23) return errorResult(normalized.error?.message ?? "El radicado debe tener exactamente 23 dígitos.");
    const { data, error } = await sbForUser(ctx).rpc("mcp_assign_work_item_radicado", {
      p_work_item_id: args.work_item_id, p_radicado: normalized.radicado23,
      p_expected_updated_at: args.expected_updated_at, p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Radicado guardado; sincronización programada pendiente.", data as Record<string, unknown>);
  },
});