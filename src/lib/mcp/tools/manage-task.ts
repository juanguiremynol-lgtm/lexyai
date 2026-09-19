import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  callerOrganizationId,
  errorResult,
  requireWriteScope,
  resolveWorkItem,
  sbForUser,
  textResult,
} from "../shared";

export default defineTool({
  name: "manage_task",
  title: "Crear, editar o completar una tarea",
  description:
    "Creates a task on a matter, edits its title/description/priority/due date, or marks it done or reopened. Tasks are internal work reminders — they are never procedural deadlines.",
  inputSchema: {
    action: z.enum(["create", "update", "complete", "reopen"]),
    task_id: z.string().uuid().optional().describe("Requerido salvo para create."),
    radicado: z.string().trim().optional().describe("Asunto de la tarea (para create)."),
    work_item_id: z.string().uuid().optional(),
    title: z.string().trim().max(300).optional(),
    description: z.string().trim().max(3000).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha límite interna (YYYY-MM-DD)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);
    const userId = ctx.getUserId?.();
    if (!userId) return errorResult("No se pudo identificar al usuario del token.");

    const dueISO = args.due_date ? `${args.due_date}T17:00:00-05:00` : undefined;

    if (args.action === "create") {
      if (!args.title) return errorResult("Indica el título de la tarea.");
      const resolved = await resolveWorkItem(sb, { id: args.work_item_id, radicado: args.radicado });
      const item = resolved.item;
      if (resolved.error || !item) return errorResult(resolved.error ?? "Asunto no encontrado.");
      const orgId = await callerOrganizationId(sb, userId);

      const { data, error } = await sb
        .from("work_item_tasks")
        .insert({
          owner_id: userId,
          organization_id: orgId,
          work_item_id: item.id as string,
          title: args.title,
          description: args.description ?? null,
          priority: args.priority ?? "MEDIUM",
          due_date: dueISO ?? null,
          status: "OPEN",
        })
        .select("id, work_item_id, title, priority, due_date, status")
        .maybeSingle();
      if (error) return errorResult(error.message);
      return textResult(`Tarea creada en ${item.radicado ?? item.id}.`, { task: data });
    }

    if (!args.task_id) return errorResult("Indica el task_id.");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (args.action === "complete") {
      patch.status = "DONE";
      patch.completed_at = new Date().toISOString();
      patch.completed_by = userId;
    } else if (args.action === "reopen") {
      patch.status = "OPEN";
      patch.completed_at = null;
      patch.completed_by = null;
    } else {
      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.priority !== undefined) patch.priority = args.priority;
      if (dueISO !== undefined) patch.due_date = dueISO;
      if (Object.keys(patch).length === 1) return errorResult("No indicaste ningún campo para cambiar.");
    }

    const { data, error } = await sb
      .from("work_item_tasks")
      .update(patch)
      .eq("id", args.task_id)
      .select("id, work_item_id, title, priority, due_date, status, completed_at")
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Tarea no encontrada (o no pertenece a tu cuenta).");
    return textResult(`Tarea actualizada (${args.action}).`, { task: data });
  },
});
