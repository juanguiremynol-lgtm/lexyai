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
    city: z.string().trim().optional().describe("Filtro opcional por ciudad del despacho."),
    limit: z.number().int().min(1).max(50).optional().describe("Máximo de resultados (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, workflow_type, city, limit }, ctx) => {
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
    if (city) q = q.ilike("authority_city", `%${city}%`);

    const { data, error } = await q;
    if (error) return errorResult(error.message);

    return textResult(
      `${data?.length ?? 0} asuntos coinciden con "${query}".`,
      { query, filters: { workflow_type: workflow_type ?? null, city: city ?? null }, items: data ?? [] },
    );
  },
});