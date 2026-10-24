import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "resolve_detected_process",
  title: "Resolver un proceso detectado",
  description:
    "Resolves a PENDING detected process (list_detected_processes): dismiss, matched_existing (link to an existing matter with the same radicado base) or created (link to a matter created after the detection, e.g. with create_work_item). Requires a manage grant.",
  inputSchema: {
    detected_process_id: z.string().uuid(),
    decision: z.enum(["dismiss", "matched_existing", "created"]),
    work_item_id: z.string().uuid().optional().describe("Obligatorio salvo para dismiss."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const { data, error } = await sbForUser(ctx).rpc("mcp_resolve_detected_process", {
      p_id: args.detected_process_id,
      p_decision: args.decision,
      p_work_item_id: args.work_item_id ?? null,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    return textResult("Proceso detectado resuelto.", data as Record<string, unknown>);
  },
});
