import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, resolveWorkItem, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "get_work_item",
  title: "Detalle de asunto",
  description:
    "Fetches details for one legal matter (work_item) by id or by radicado, including recent actuaciones and estados.",
  inputSchema: {
    id: z.string().uuid().optional().describe("work_item UUID."),
    radicado: z
      .string()
      .trim()
      .optional()
      .describe(
        "Radicado en cualquier forma: 23 dígitos, con guiones, con espacios, base de 21 dígitos, 22 dígitos sin el cero inicial o base+instancia.",
      ),
    verbose: z
      .boolean()
      .optional()
      .describe("Si es true devuelve el objeto work_item crudo completo (~150 campos internos). Default false."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, radicado, verbose }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    if (!id && !radicado) return errorResult("Indica el id o el radicado del asunto.");
    const sb = sbForUser(ctx);
    const resolved = await resolveWorkItem(sb, { id, radicado }, "*");
    if (resolved.error || !resolved.item) {
      return errorResult(resolved.error ?? "Asunto no encontrado (o no pertenece a tu cuenta).");
    }
    const item = resolved.item as Record<string, any>;

    const [{ data: acts }, { data: estados }, { data: deadlines }, { data: hearings }] = await Promise.all([
      sb.from("work_item_acts")
        .select("id, act_date, act_type, description, despacho, source, detected_at")
        .eq("work_item_id", item.id)
        .or("is_archived.is.null,is_archived.eq.false")
        .order("act_date", { ascending: false })
        .limit(20),
      sb.from("work_item_publicaciones")
        .select("id, fecha_fijacion, fecha_desfijacion, tipo_publicacion, title, annotation, despacho, source, pdf_available, detected_at")
        .eq("work_item_id", item.id)
        .or("is_archived.is.null,is_archived.eq.false")
        .order("fecha_fijacion", { ascending: false })
        .limit(20),
      sb.from("work_item_deadlines")
        .select("id, deadline_type, label, trigger_date, deadline_date, business_days_count, status")
        .eq("work_item_id", item.id)
        .eq("status", "PENDING")
        .order("deadline_date", { ascending: true })
        .limit(20),
      sb.from("work_item_hearings")
        .select("id, custom_name, status, scheduled_at, modality, location")
        .eq("work_item_id", item.id)
        .order("scheduled_at", { ascending: true })
        .limit(10),
    ]);

    const resumen = {
      radicado: item.radicado ?? null,
      titulo: item.title ?? null,
      workflow_type: item.workflow_type ?? null,
      stage: item.stage ?? null,
      status: item.status ?? null,
      despacho: item.authority_name ?? null,
      ciudad: item.authority_city ?? null,
      departamento: item.authority_department ?? item.departamento ?? null,
      demandantes: item.demandantes ?? null,
      demandados: item.demandados ?? null,
      client_id: item.client_id ?? null,
      ultima_actuacion: item.last_action_date ?? null,
      ultima_actuacion_descripcion: item.last_action_description ?? null,
    };

    // Procedural-relevant projection: keeps the AI context window focused.
    const ITEM_FIELDS = [
      "id", "radicado", "workflow_type", "stage", "status", "lifecycle_state",
      "title", "description",
      "authority_name", "authority_email", "authority_city", "authority_department",
      "demandantes", "demandados", "client_id",
      "cgp_class", "cgp_variant", "cgp_cuantia", "cgp_instancia",
      "ponente", "clase_proceso", "tipo_proceso", "fecha_radicado",
      "total_actuaciones", "total_sujetos_procesales",
      "monitoring_enabled", "last_successful_sync_at", "created_at",
    ] as const;
    const source = item as Record<string, unknown>;
    const slimItem: Record<string, unknown> = {};
    for (const key of ITEM_FIELDS) {
      if (source[key] !== undefined && source[key] !== null) slimItem[key] = source[key];
    }

    return textResult(
      `${resolved.note ? `${resolved.note}\n` : ""}Asunto ${item.radicado ?? item.id} — ${item.workflow_type} — ${item.authority_name ?? "despacho sin registrar"} — ${acts?.length ?? 0} actuaciones, ${estados?.length ?? 0} estados, ${deadlines?.length ?? 0} términos activos.`,
      {
        resolucion: resolved.note ?? null,
        resumen,
        item: verbose ? item : slimItem,
        recent_acts: acts ?? [],
        recent_estados: estados ?? [],
        terminos_activos: deadlines ?? [],
        audiencias: hearings ?? [],
      },
    );
  },
});