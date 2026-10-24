import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { canonicalWorkflowType, errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { getDefaultStage, type WorkflowType } from "../../workflow-constants";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export default defineTool({
  name: "create_work_item",
  title: "Crear asunto",
  description:
    "Creates a matter for the signed-in user with the same defaults as the app wizard (initial stage, monitoring rule, plan limits and duplicate check enforced by the database). Requires the user's explicit instruction and a manage grant.",
  inputSchema: {
    workflow_type: z.string().trim().min(2).describe("Tipo de proceso (CGP, CPACA, LABORAL, PENAL_906, TUTELA, PETICION, GOV_PROCEDURE, EJECUTIVO)."),
    radicado: z.string().trim().optional().describe("Radicado de 23 dígitos (con o sin guiones). Sin radicado el monitoreo queda pendiente de radicación."),
    title: z.string().trim().max(300).optional(),
    client_id: z.string().uuid().optional().describe("Cliente propio del usuario."),
    demandantes: z.string().trim().max(1000).optional(),
    demandados: z.string().trim().max(1000).optional(),
    authority_name: z.string().trim().max(300).optional().describe("Despacho, si se conoce."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const wf = canonicalWorkflowType(args.workflow_type);
    const stage = getDefaultStage(wf as WorkflowType, wf === "CGP" ? "FILING" : undefined);
    if (!stage) return errorResult(`No hay etapa inicial definida para ${wf}.`);
    const { data, error } = await sbForUser(ctx).rpc("mcp_create_work_item", {
      p_workflow_type: wf,
      p_stage: stage,
      p_radicado: args.radicado ?? null,
      p_title: args.title ?? null,
      p_client_id: args.client_id ?? null,
      p_demandantes: args.demandantes ?? null,
      p_demandados: args.demandados ?? null,
      p_authority_name: args.authority_name ?? null,
      // Creation has no explicit suspension input; the database derives automatic noneligibility.
      p_monitoring_off_reason: null,
      p_idempotency_key: args.idempotency_key,
    });
    if (error) return errorResult(rpcErrorText(error));
    const r = data as Record<string, unknown>;
    return textResult(`Asunto creado${r.replayed ? " (respuesta repetida, sin duplicar)" : ""}.`, r);
  },
});
