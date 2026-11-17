import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";
import {
  FILING_ACTION_KINDS, FILING_CHANNELS, FILING_WORKFLOWS, GOV_PROCEDURE_SUBTYPES, TRIBUNAL_TYPES, validateFilingInput,
} from "../../filings/filing-constants";

export default defineTool({
  name: "register_filing",
  title: "Registrar presentación (radicación)",
  description:
    "Records a filing the user ACCREDITS was already presented (demanda, tutela, memorial, recurso, impugnación, descargos, solicitud administrativa). Never sends email nor files anything with an authority. Attaches a new filing event to an existing matter (work_item_id or exact 23-digit radicado) or creates exactly ONE new matter with its event in the same transaction. Presentation is never receipt, admission or notification; no judicial term is created — demanda/tutela/memorial/recurso/descargos get status PENDING_LEGAL_TRIGGER_REVIEW and one review task. New petitions must use create_peticion. Workflow is never inferred from the authority name: CPACA is judicial (SAMAI); administrative sanctioning files (tránsito, ambiental…) are GOV_PROCEDURE with procedure_subtype; a superintendence acting jurisdictionally is CGP with tribunal_type AUTORIDAD_JURISDICCIONAL. Requires a manage grant.",
  inputSchema: {
    action_kind: z.enum(FILING_ACTION_KINDS),
    filed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha declarada de presentación YYYY-MM-DD (Bogotá). Nunca la fecha de creación de la ficha."),
    channel: z.enum(FILING_CHANNELS),
    filing_reference: z.string().trim().min(3).max(1000).describe("Soporte de presentación: descripción y enlace o identificador (sin contraseñas ni enlaces firmados)."),
    external_reference: z.string().trim().max(120).optional().describe("SPOA, comparendo, expediente sancionador o radicado administrativo, tal cual (no se exige 23 dígitos)."),
    observaciones: z.string().trim().max(2000).optional(),
    work_item_id: z.string().uuid().optional().describe("Asunto existente donde registrar la presentación."),
    radicado: z.string().trim().optional().describe("Radicado judicial de 23 dígitos de un asunto existente (o del nuevo)."),
    workflow_type: z.enum(FILING_WORKFLOWS).optional().describe("Obligatorio para asunto nuevo; se valida contra el existente."),
    procedure_subtype: z.enum(GOV_PROCEDURE_SUBTYPES).optional().describe("Solo GOV_PROCEDURE."),
    tribunal_type: z.enum(TRIBUNAL_TYPES).optional(),
    related_work_item_id: z.string().uuid().optional().describe("Asunto relacionado (p.ej. el trámite administrativo que impugna una demanda CPACA)."),
    title: z.string().trim().max(300).optional(),
    client_id: z.string().uuid().optional(),
    demandantes: z.string().trim().max(1000).optional(),
    demandados: z.string().trim().max(1000).optional(),
    authority_name: z.string().trim().max(300).optional(),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (a, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const pre = validateFilingInput({ ...a, source_reference: a.filing_reference });
    if (pre === "USE_CREATE_PETICION") return errorResult("USE_CREATE_PETICION: las peticiones nuevas se crean con create_peticion; para una existente indica su work_item_id.");
    if (pre) return errorResult(pre);
    const { data, error } = await sbForUser(ctx).rpc("mcp_register_filing", {
      p_action_kind: a.action_kind, p_filed_on: a.filed_on, p_channel: a.channel, p_source_reference: a.filing_reference,
      p_external_reference: a.external_reference ?? null, p_observaciones: a.observaciones ?? null,
      p_workflow_type: a.workflow_type ?? null, p_procedure_subtype: a.procedure_subtype ?? null, p_tribunal_type: a.tribunal_type ?? null,
      p_work_item_id: a.work_item_id ?? null, p_radicado: a.radicado ?? null, p_title: a.title ?? null, p_client_id: a.client_id ?? null,
      p_demandantes: a.demandantes ?? null, p_demandados: a.demandados ?? null, p_authority_name: a.authority_name ?? null,
      p_related_work_item_id: a.related_work_item_id ?? null, p_origin: "MCP", p_idempotency_key: a.idempotency_key,
    } as never);
    if (error) return errorResult(rpcErrorText(error));
    const r = data as Record<string, unknown>;
    const head = r.duplicate_support ? "Esta presentación ya estaba registrada con el mismo soporte; no se duplicó."
      : r.created_work_item ? "Se creó un asunto nuevo y se registró la presentación."
      : "Presentación registrada en el asunto existente.";
    const terms = r.deadline_effect === "PENDING_TRIGGER"
      ? " No se creó ningún término: queda una tarea para revisar el evento habilitante (notificación, traslado, providencia)."
      : "";
    return textResult(`${head} Estado: presentado, recepción no acreditada.${terms}${r.replayed ? " (respuesta repetida)" : ""}`, r);
  },
});
