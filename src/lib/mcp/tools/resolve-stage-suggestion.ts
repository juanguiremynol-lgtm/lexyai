import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { appStageOrder, loadWorkItemRevision, MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "resolve_stage_suggestion",
  title: "Aplicar o descartar una sugerencia de etapa",
  description:
    "Applies (moves the stage) or dismisses one PENDING stage suggestion. Apply checks the matter revision and the workflow catalogue; regressions are rejected. A suggestion already resolved by someone else returns a conflict. Only on the user's explicit decision; requires a manage grant.",
  inputSchema: {
    suggestion_id: z.string().uuid(),
    decision: z.enum(["apply", "dismiss"]),
    expected_updated_at: z.string().min(10).optional().describe("Obligatorio para apply: updated_at del asunto tal como lo leíste."),
    reason: z.string().trim().max(500).optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);
    const { data: sug, error: sErr } = await sb
      .from("work_item_stage_suggestions").select("work_item_id").eq("id", args.suggestion_id).maybeSingle();
    if (sErr) return errorResult(sErr.message);
    if (!sug) return errorResult("Sugerencia no encontrada.");
    const { item } = await loadWorkItemRevision(sb, String((sug as { work_item_id: string }).work_item_id));
    const { data, error } = await sb.rpc("mcp_resolve_stage_suggestion", {
      p_suggestion_id: args.suggestion_id,
      p_decision: args.decision,
      p_expected_updated_at: args.expected_updated_at ?? null,
      p_app_stage_order: item ? appStageOrder(String(item.workflow_type), item.cgp_phase) : [],
      p_idempotency_key: args.idempotency_key,
      p_reason: args.reason ?? null,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult(args.decision === "apply" ? "Sugerencia aplicada." : "Sugerencia descartada.", data as Record<string, unknown>);
  },
});
