import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "get_work_item",
  title: "Detalle de asunto",
  description:
    "Fetches details for one legal matter (work_item) by id or by radicado, including recent actuaciones and estados.",
  inputSchema: {
    id: z.string().uuid().optional().describe("work_item UUID."),
    radicado: z.string().trim().optional().describe("Radicado exacto (23-dígitos u otro formato)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id, radicado }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    if (!id && !radicado) return errorResult("Indica el id o el radicado del asunto.");
    const sb = sbForUser(ctx);
    let q = sb.from("work_items").select("*").is("deleted_at", null).limit(1);
    if (id) q = q.eq("id", id);
    else if (radicado) q = q.eq("radicado", radicado);
    const { data: itemRows, error } = await q;
    if (error) return errorResult(error.message);
    const item = itemRows?.[0];
    if (!item) return errorResult("Asunto no encontrado (o no pertenece a tu cuenta).");

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

    return textResult(
      `Asunto ${item.radicado ?? item.id} — ${item.workflow_type} — ${item.authority_name ?? "despacho sin registrar"} — ${acts?.length ?? 0} actuaciones, ${estados?.length ?? 0} estados, ${deadlines?.length ?? 0} términos activos.`,
      {
        resumen,
        item,
        recent_acts: acts ?? [],
        recent_estados: estados ?? [],
        terminos_activos: deadlines ?? [],
        audiencias: hearings ?? [],
      },
    );
  },
});