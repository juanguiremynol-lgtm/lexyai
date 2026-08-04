import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { canonicalWorkflowType, errorResult, requireAuth, sbForUser, textResult } from "../shared";

/**
 * Single search implementation for web AND MCP: both call the SQL function
 * `public.search_work_items_normalized` (SECURITY INVOKER, so RLS applies).
 * The MCP layer only re-applies its optional filters and preserves the legacy
 * response shape.
 */
const MATCHED_FIELD_KEYS: Record<string, string> = {
  radicado: "radicado",
  "radicado parcial": "radicado_parcial",
  titulo: "titulo",
  demandante: "demandante",
  demandado: "demandado",
  despacho: "despacho",
  ciudad: "ciudad",
  tipo: "tipo",
  etapa: "etapa",
  cliente: "cliente",
  "correo del despacho": "correo_despacho",
  "correo vinculado": "correo_vinculado",
};

export default defineTool({
  name: "search",
  title: "Búsqueda libre",
  description:
    "Normalized free-text search across the caller's matters: radicado in ANY form (23 digits, hyphenated, spaced, 21-digit base, 22-digit missing leading zero, base+instance) plus partial radicados, título, partes, cliente y su identificación, despacho, ciudad, tipo, etapa, correo del despacho y correos vinculados confirmados. Multi-token queries are AND across fields. Each result reports `matched_on` (why it surfaced). Results are RLS-scoped to the caller.",
  inputSchema: {
    query: z
      .string()
      .trim()
      .min(2)
      .describe("Texto libre: parte, despacho, ciudad, correo del despacho, radicado (cualquier forma o parcial) o título."),
    workflow_type: z.string().trim().optional().describe("Filtro opcional: CGP, CPACA, LABORAL, PENAL_906, TUTELA, PETICION, GOV_PROCEDURE ('PENAL' se acepta como alias de PENAL_906)."),
    client_id: z.string().uuid().optional().describe("Filtro opcional por cliente (UUID)."),
    status: z.string().trim().optional().describe("Filtro opcional por estado del asunto (p. ej. ACTIVE)."),
    city: z.string().trim().optional().describe("Filtro opcional por ciudad del despacho."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, workflow_type, client_id, status, city, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const max = limit ?? 20;

    // Over-fetch so the optional MCP-side filters still return up to `max`.
    const hasFilters = Boolean(workflow_type || client_id || status || city);
    const { data, error } = await sb.rpc("search_work_items_normalized", {
      p_query: query,
      p_limit: hasFilters ? Math.min(max * 5, 200) : max,
    });
    if (error) return errorResult(error.message);

    const hits = (data as unknown as Record<string, unknown>[]) ?? [];
    if (hits.length === 0) {
      return textResult(`0 asuntos coinciden con "${query}".`, {
        query,
        filters: { workflow_type: workflow_type ?? null, client_id: client_id ?? null, status: status ?? null, city: city ?? null },
        items: [],
      });
    }

    // The RPC intentionally returns a compact projection; hydrate the extra
    // columns the MCP response shape has always carried (status, client_id,
    // última actuación) and apply the optional filters with the same RLS view.
    const ids = hits.map((h) => String(h.id));
    let q = sb
      .from("work_items")
      .select("id, radicado, title, workflow_type, stage, status, client_id, authority_name, authority_city, demandantes, demandados, last_action_date, last_action_description, updated_at")
      .in("id", ids);
    if (workflow_type) q = q.eq("workflow_type", canonicalWorkflowType(workflow_type));
    if (client_id) q = q.eq("client_id", client_id);
    if (status) q = q.eq("status", status.toUpperCase());
    if (city) q = q.ilike("authority_city", `%${city}%`);
    const { data: rows, error: rowsErr } = await q;
    if (rowsErr) return errorResult(rowsErr.message);

    const byId = new Map(
      ((rows as unknown as Record<string, unknown>[]) ?? []).map((r) => [String(r.id), r]),
    );

    // Preserve the RPC's ranking (match_rank, then updated_at).
    const items = hits
      .filter((h) => byId.has(String(h.id)))
      .slice(0, max)
      .map((h) => {
        const row = byId.get(String(h.id))!;
        const fields = ((h.matched_fields as string[] | null) ?? []).filter(Boolean);
        return {
          ...row,
          client_name: h.client_name ?? null,
          matched_on: fields.map((f) => MATCHED_FIELD_KEYS[f] ?? f),
          matched_fields: fields,
          match_rank: h.match_rank ?? null,
          // Kept for backwards compatibility: lower rank = better match.
          relevance_score: 6 - Number(h.match_rank ?? 5),
        };
      });

    return textResult(
      `${items.length} asuntos coinciden con "${query}".`,
      {
        query,
        filters: { workflow_type: workflow_type ?? null, client_id: client_id ?? null, status: status ?? null, city: city ?? null },
        items,
      },
    );
  },
});