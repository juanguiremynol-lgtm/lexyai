import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  callerOrganizationId,
  errorResult,
  requireWriteScope,
  resolveWorkItem,
  rpcErrorText,
  sbForUser,
  textResult,
} from "../shared";

export default defineTool({
  name: "add_hearing",
  title: "Agendar audiencia",
    description:
    "Schedules a hearing (audiencia) on one of the caller's matters. Requires a manage grant (see get_capabilities). It only inserts new hearings: it never deletes, reschedules by deletion, reclassifies, or changes the lifecycle of a matter.",
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
    modality: z.enum(["presencial", "virtual", "mixta"]).optional().describe("Modalidad; si se omite se deduce virtual solo para enlaces HTTP, presencial en otro caso."),
    hearing_id: z.string().uuid().optional().describe("Para corregir una audiencia existente sin cambiar su identidad; omitir para crear."),
    expected_updated_at: z.string().datetime({ offset: true }).optional().describe("Revisión leída de la audiencia, obligatoria al corregir."),
    reason: z.string().trim().min(5).max(2000).optional().describe("Fuente y motivo de corrección; obligatorio al corregir."),
    idempotency_key: z.string().min(8).max(200).optional(),
    status: z.enum(["planned", "scheduled", "held", "postponed", "cancelled"]).optional().describe("Solo al corregir; held requiere occurred_at acreditado."),
    occurred_at: z.string().datetime({ offset: true }).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ work_item_id, radicado, date, description, location, modality, hearing_id, expected_updated_at, reason, idempotency_key, status, occurred_at }, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);

    const when = new Date(date);
    if (Number.isNaN(when.getTime()) || !/(Z|[+-]\d{2}:\d{2})$/i.test(date)) return errorResult("Fecha inválida: usa ISO 8601 con zona horaria explícita, por ejemplo -05:00.");

    if (hearing_id) {
      if (!expected_updated_at || !reason || !idempotency_key) return errorResult("Corregir requiere expected_updated_at, reason e idempotency_key.");
      const patch = { scheduled_at: when.toISOString(), custom_name: description,
        ...(location !== undefined ? { location } : {}), ...(modality ? { modality } : {}),
        ...(status ? { status } : {}), ...(occurred_at ? { occurred_at } : {}) };
      const { data, error } = await sb.rpc("mcp_correct_hearing", { p_hearing_id: hearing_id, p_patch: patch, p_expected_updated_at: expected_updated_at, p_reason: reason, p_idempotency_key: idempotency_key });
      if (error) return errorResult(rpcErrorText(error));
      return textResult("Audiencia corregida conservando su identidad y auditoría.", data as Record<string, unknown>);
    }
    if (status || occurred_at) return errorResult("status y occurred_at requieren hearing_id para una corrección explícita.");

    const resolved = await resolveWorkItem(sb, { id: work_item_id, radicado });
    if (resolved.error || !resolved.item) return errorResult(resolved.error ?? "Asunto no encontrado.");
    const itemId = resolved.item.id as string;

    const userId = ctx.getUserId();
    if (!userId) return errorResult("No se pudo identificar al usuario.");
    const orgId = await callerOrganizationId(sb, userId);

    const { data, error } = await sb
      .from("work_item_hearings")
      .insert({
        work_item_id: itemId,
        organization_id: orgId,
        custom_name: description,
        scheduled_at: when.toISOString(),
        location: location ?? null,
        status: "scheduled",
        modality: modality ?? (location && /^https?:\/\//i.test(location) ? "virtual" : "presencial"),
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