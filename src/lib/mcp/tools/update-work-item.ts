import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireWriteScope, resolveWorkItem, sbForUser, textResult, workItemTitle } from "../shared";

/**
 * Editable surface of a matter over MCP.
 *
 * What is intentionally NOT here, and why:
 *  - `radicado` / `workflow_type` / `stage`: identity, routing and procedural
 *    stage are governed by the classification and preclusion rules in the DB.
 *    An assistant must not move a matter through its procedural life.
 *  - deletion / lifecycle_state: there is no delete path over MCP, by design.
 */
export default defineTool({
  name: "update_work_item",
  title: "Editar datos de un asunto",
  description:
    "Updates the descriptive fields of a matter: title, parties, court data, links, client, flags and monitoring switches. It can NEVER change the radicado, the workflow type, the procedural stage, or delete/archive the matter.",
  inputSchema: {
    radicado: z.string().trim().optional().describe("Radicado del asunto (cualquier forma)."),
    id: z.string().uuid().optional().describe("UUID del asunto."),
    title: z.string().trim().max(300).optional().describe("Carátula / título del asunto."),
    description: z.string().trim().max(4000).optional(),
    demandantes: z.string().trim().max(1000).optional(),
    demandados: z.string().trim().max(1000).optional(),
    authority_name: z.string().trim().max(300).optional().describe("Nombre del despacho."),
    authority_email: z.string().trim().email().max(200).optional().describe("Correo del despacho."),
    authority_city: z.string().trim().max(120).optional(),
    expediente_url: z.string().trim().url().max(2000).optional(),
    client_id: z.string().uuid().optional().describe("Cliente al que se vincula el asunto."),
    is_flagged: z.boolean().optional().describe("Marcar/desmarcar como destacado."),
    monitoring_enabled: z.boolean().optional().describe("Activar o desactivar el monitoreo automático."),
    email_linking_enabled: z.boolean().optional().describe("Activar o desactivar la vinculación de correos."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);

    const resolved = await resolveWorkItem(sb, { id: args.id, radicado: args.radicado });
    const item = resolved.item;
    if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");

    const EDITABLE = [
      "title", "description", "demandantes", "demandados", "authority_name", "authority_email",
      "authority_city", "expediente_url", "client_id", "is_flagged", "monitoring_enabled",
      "email_linking_enabled",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      const v = (args as Record<string, unknown>)[key];
      if (v !== undefined) patch[key] = v;
    }
    if (Object.keys(patch).length === 0) {
      return errorResult("No indicaste ningún campo para cambiar.");
    }

    if (patch.client_id) {
      const { data: client } = await sb
        .from("clients")
        .select("id, name")
        .is("deleted_at", null)
        .eq("id", patch.client_id as string)
        .maybeSingle();
      if (!client) return errorResult("Ese cliente no existe o no pertenece a tu cuenta.");
    }

    patch.updated_at = new Date().toISOString();
    const { data, error } = await sb
      .from("work_items")
      .update(patch)
      .eq("id", item.id as string)
      .select("id, radicado, title, demandantes, demandados, authority_name, authority_email, authority_city, client_id, is_flagged, monitoring_enabled, email_linking_enabled, expediente_url")
      .maybeSingle();
    if (error) return errorResult(error.message);

    return textResult(
      `${resolved.note ? `${resolved.note}\n` : ""}Asunto ${item.radicado ?? item.id} actualizado (${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}).`,
      {
        work_item: data,
        titulo: workItemTitle((data ?? item) as Record<string, unknown>),
        cambios: patch,
        nota: "Radicado, tipo de proceso y etapa procesal no se modifican por esta vía.",
      },
    );
  },
});
