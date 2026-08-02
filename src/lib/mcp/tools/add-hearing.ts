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
  name: "add_hearing",
  title: "Agendar audiencia",
  description:
    "Schedules a hearing (audiencia) on one of the caller's matters. Requires the read_write scope. It only inserts new hearings: it never deletes, reschedules by deletion, reclassifies, or changes the lifecycle of a matter.",
  inputSchema: {
    work_item_id: z.string().uuid().optional().describe("UUID del asunto."),
    radicado: z
      .string()
      .trim()
      .optional()
      .describe("Radicado en cualquier forma: 23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin cero inicial o base+instancia."),
    date: z.string().trim().describe("Fecha y hora ISO 8601, p. ej. 2026-08-14T09:00:00-05:00 (hora de Bogotá)."),
    description: z.string().trim().min(1).max(500).describe("Nombre o descripción de la audiencia."),
    location: z.string().trim().max(300).optional().describe("Lugar o enlace de la audiencia."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ work_item_id, radicado, date, description, location }, ctx) => {
    const denied = requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);

    const when = new Date(date);
    if (Number.isNaN(when.getTime())) return errorResult("Fecha inválida: usa formato ISO 8601.");

    const resolved = await resolveWorkItem(sb, { id: work_item_id, radicado });
    if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
    const itemId = resolved.item.id as string;

    const orgId = await callerOrganizationId(sb, ctx.getUserId()!);

    const { data, error } = await sb
      .from("work_item_hearings")
      .insert({
        work_item_id: itemId,
        organization_id: orgId,
        custom_name: description,
        scheduled_at: when.toISOString(),
        location: location ?? null,
        status: "SCHEDULED",
        modality: location && /^https?:\/\//i.test(location) ? "VIRTUAL" : "PRESENCIAL",
        created_by: ctx.getUserId(),
        notes_plain_text: "Agendada vía asistente de IA (MCP).",
      })
      .select("id, work_item_id, custom_name, scheduled_at, location, status")
      .maybeSingle();

    if (error) return errorResult(error.message);

    return textResult(
      `${resolved.note ? `${resolved.note}\n` : ""}Audiencia agendada para el asunto ${resolved.item.radicado ?? itemId}.`,
      { resolucion: resolved.note ?? null, hearing: data ?? null },
    );
  },
});