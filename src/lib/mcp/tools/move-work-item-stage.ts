import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { appStageOrder, loadWorkItemRevision, MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "move_work_item_stage",
  title: "Mover la etapa procesal de un asunto",
  description:
    "Moves an active matter to another valid stage of its workflow (see list_workflow_stages), validated server-side like the app boards: governed workflows follow configured transitions (including allowed regressions); backward or cross-phase moves require the user's reason. Unknown stages and stale revisions are rejected; inference settings are untouched. Only on the user's explicit instruction; requires a manage grant.",
  inputSchema: {
    work_item_id: z.string().uuid(),
    to_stage: z.string().trim().min(1).describe("Código de etapa del catálogo."),
    expected_updated_at: z.string().min(10).describe("updated_at del asunto tal como lo leíste."),
    reason: z.string().trim().max(500).optional().describe("Motivo del usuario; obligatorio (mín. 5 caracteres) para retrocesos o cambios de fase."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);
    const { item, error: loadErr } = await loadWorkItemRevision(sb, args.work_item_id);
    if (!item) return errorResult(loadErr ?? "Asunto no encontrado.");
    const { data, error } = await sb.rpc("mcp_move_work_item_stage", {
      p_work_item_id: args.work_item_id,
      p_to_stage: args.to_stage,
      p_expected_updated_at: args.expected_updated_at,
      p_app_stage_order: appStageOrder(String(item.workflow_type), item.cgp_phase),
      p_idempotency_key: args.idempotency_key,
      p_reason: args.reason ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Etapa actualizada.", data as Record<string, unknown>);
  },
});
