import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, errorResult, IDEMPOTENCY_KEY_DESCRIPTION, requireWriteScope, rpcErrorText, sbForUser, textResult } from "../shared";
import { MANAGE_ANNOTATIONS } from "../manage-helpers";

export const PETICION_COMPONENTS = ["DOCUMENTOS_INFORMACION", "GENERAL_INTERVENCION", "CONSULTA", "ESPECIAL"] as const;

/** Resolves the presentation date: explicit date, or today only when the agent confirms it explicitly. Never created_at. */
export function resolvePresentationDate(args: {
  presented?: boolean;
  fecha_presentacion?: string;
  presentado_hoy_confirmado?: boolean;
}, today: string): { date: string | null; error?: string } {
  if (!args.presented) {
    if (args.fecha_presentacion || args.presentado_hoy_confirmado) {
      return { date: null, error: "Indica presented=true si la petición ya fue presentada." };
    }
    return { date: null };
  }
  if (args.fecha_presentacion) return { date: args.fecha_presentacion };
  if (args.presentado_hoy_confirmado) return { date: today };
  return { date: null, error: "FECHA_PRESENTACION_REQUERIDA: indica fecha_presentacion (YYYY-MM-DD) o confirma explícitamente que fue hoy. Nunca se usa la fecha de creación de la ficha." };
}

export default defineTool({
  name: "create_peticion",
  title: "Crear petición (con presentación)",
  description:
    "Creates a PETICION matter and, when it was already presented, registers the documented presentation and computes the authority's response terms (10/15/30 business days per component, administrative calendar) in ONE atomic, idempotent database transaction. Without a presentation it creates a draft with status FECHA_PRESENTACION_PENDIENTE and an informative task — never a fictitious term. Requires the user's explicit instruction and a manage grant.",
  inputSchema: {
    title: z.string().trim().max(300).optional(),
    client_id: z.string().uuid().optional().describe("Cliente propio del usuario."),
    peticionario: z.string().trim().max(1000).optional().describe("Quien presenta la petición."),
    authority_name: z.string().trim().max(300).optional().describe("Autoridad administrativa destinataria."),
    referencia_autoridad: z.string().trim().max(120).optional().describe("Radicado o referencia administrativa tal como la dio la entidad (no es un radicado judicial; no se rellena con ceros)."),
    presented: z.boolean().describe("true solo si la petición YA fue presentada por un canal válido."),
    fecha_presentacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha de presentación YYYY-MM-DD (Bogotá)."),
    presentado_hoy_confirmado: z.boolean().optional().describe("Usar solo si el usuario confirmó expresamente que se presentó hoy."),
    canal: z.enum(["EMAIL_OFICIAL", "PLATAFORMA", "OTRO"]).optional(),
    fuente: z.enum(["USUARIO_DECLARADO", "OUTLOOK", "PLATAFORMA"]).optional().describe("De dónde sale la fecha."),
    soporte: z.string().trim().max(900).optional().describe("Descripción del soporte (correo enviado, recibo del portal…)."),
    componentes: z.array(z.enum(PETICION_COMPONENTS)).max(4).optional().describe("Partes de la petición: documentos/información (10), general/intervención (15), consulta (30), especial (revisión manual)."),
    idempotency_key: z.string().min(8).max(200).describe(IDEMPOTENCY_KEY_DESCRIPTION),
  },
  annotations: { ...MANAGE_ANNOTATIONS },
  handler: async (args, ctx) => {
    const denied = await requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const resolved = resolvePresentationDate(args, bogotaToday());
    if (resolved.error) return errorResult(resolved.error);
    if (args.presented && (!args.canal || !args.fuente || !args.soporte || !args.componentes?.length)) {
      return errorResult("Para una petición presentada indica canal, fuente, soporte y al menos un componente.");
    }
    const { data, error } = await sbForUser(ctx).rpc("mcp_create_peticion", {
      p_title: args.title ?? null,
      p_client_id: args.client_id ?? null,
      p_peticionario: args.peticionario ?? null,
      p_authority_name: args.authority_name ?? null,
      p_authority_reference: args.referencia_autoridad ?? null,
      p_presented: args.presented,
      p_presented_on: resolved.date,
      p_channel: args.canal ?? null,
      p_source: args.fuente ?? null,
      p_support: args.soporte ?? null,
      p_components: args.componentes ?? null,
      p_idempotency_key: args.idempotency_key,
    } as never);
    if (error) return errorResult(rpcErrorText(error));
    const r = data as Record<string, unknown>;
    const msg = r.status === "FECHA_PRESENTACION_PENDIENTE"
      ? "Petición creada como borrador: FECHA_PRESENTACION_PENDIENTE. No se calculó ningún término; quedó una tarea para registrar la fecha."
      : `Petición creada y presentación registrada (${String(r.presented_on)}). Términos calculados desde la presentación documentada; la recepción por la entidad no queda acreditada.`;
    return textResult(`${msg}${r.replayed ? " (respuesta repetida, sin duplicar)" : ""}`, r);
  },
});
