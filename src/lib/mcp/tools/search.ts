import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

export default defineTool({
  name: "search",
  title: "Búsqueda libre",
  description:
    "Free-text search across the caller's matters: radicado, título, partes (demandantes/demandados), authority (despacho) and city. Use it for natural queries like 'el caso contra Bancolombia en Medellín'. Results are RLS-scoped to the caller.",
  inputSchema: {
    query: z.string().trim().min(2).describe("Texto libre: parte, despacho, ciudad, radicado o título."),
    workflow_type: z.string().trim().optional().describe("Filtro opcional: CGP, CPACA, LABORAL, PENAL, TUTELA, PETICION."),
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

    // Split the query into terms so "Bancolombia Medellín" matches a party in
    // one column and the city in another.
    const terms = query.split(/\s+/).filter((t) => t.length >= 3).slice(0, 4);
    const needles = terms.length ? terms : [query];

    let q = sb
      .from("work_items")
      .select(
        "id, radicado, title, workflow_type, stage, status, authority_name, authority_city, demandantes, demandados, last_action_date, last_action_description, updated_at",
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);

    for (const term of needles) {
      const s = `%${term}%`;
      q = q.or(
        [
          `radicado.ilike.${s}`,
          `title.ilike.${s}`,
          `authority_name.ilike.${s}`,
          `authority_city.ilike.${s}`,
          `demandantes.ilike.${s}`,
          `demandados.ilike.${s}`,
        ].join(","),
      );
    }
    if (workflow_type) q = q.eq("workflow_type", workflow_type.toUpperCase());
    if (client_id) q = q.eq("client_id", client_id);
    if (status) q = q.eq("status", status.toUpperCase());
    if (city) q = q.ilike("authority_city", `%${city}%`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    // Relevance score: how many query terms the row matches across its
    // searchable columns (radicado matches weigh double).
    const scored = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const hay = ["radicado", "title", "authority_name", "authority_city", "demandantes", "demandados"]
        .map((k) => String(r[k] ?? "").toLowerCase());
      let score = 0;
      for (const term of needles) {
        const t = term.toLowerCase();
        if (hay[0].includes(t)) score += 2;
        if (hay.slice(1).some((h) => h.includes(t))) score += 1;
      }
      return { ...r, relevance_score: score };
    }).sort((a, b) => (b.relevance_score as number) - (a.relevance_score as number));

    return textResult(
      `${scored.length} asuntos coinciden con "${query}".`,
      {
        query,
        filters: { workflow_type: workflow_type ?? null, client_id: client_id ?? null, status: status ?? null, city: city ?? null },
        items: scored,
      },
    );
  },
});