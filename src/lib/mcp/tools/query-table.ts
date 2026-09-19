import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";
import { READABLE_TABLES } from "./describe-data-model";

/**
 * Generic, RLS-scoped read against the catalogued tables.
 *
 * Deliberately NOT raw SQL: the assistant composes column/filter/order/limit
 * and PostgREST executes it with the caller's own token. Anything the caller
 * cannot see under RLS simply does not come back.
 */
const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"] as const;

export default defineTool({
  name: "query_table",
  title: "Consultar una tabla de Andromeda",
  description:
    "Runs a filtered, ordered, limited read against one catalogued Andromeda table using the caller's own credentials (RLS enforced). Call `describe_data_model` first for table and column names. Read-only: it can never write, delete, or run raw SQL.",
  inputSchema: {
    table: z.string().trim().describe("Nombre de la tabla (ver `describe_data_model`)."),
    columns: z.string().trim().optional().describe("Columnas separadas por coma. Default: todas."),
    filters: z
      .array(
        z.object({
          column: z.string().trim(),
          op: z.enum(OPERATORS).describe("eq, neq, gt, gte, lt, lte, like, ilike, is, in"),
          value: z.string().describe("Valor. Para `in` usa coma: A,B,C. Para `is` usa null/true/false."),
        }),
      )
      .max(8)
      .optional()
      .describe("Condiciones combinadas con AND."),
    order_by: z.string().trim().optional().describe("Columna de ordenamiento."),
    descending: z.boolean().optional().describe("Orden descendente (default true cuando hay order_by)."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ table, columns, filters, order_by, descending, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);

    const name = table.trim().toLowerCase();
    if (!READABLE_TABLES[name]) {
      return errorResult(
        `La tabla "${table}" no está habilitada para consulta por MCP. Usa \`describe_data_model\` para ver las disponibles.`,
      );
    }

    // AUDIT FINDING 13 — a PostgREST select string can embed related tables
    // (`clients(*)`, `alias:otra_tabla(col)`), which reaches tables that are NOT
    // in the catalogue. Only plain column names are accepted here.
    const COLUMN_RE = /^[a-z0-9_]+$/;
    const requested = (columns?.trim() || "*")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const invalid = requested.filter((c) => c !== "*" && !COLUMN_RE.test(c));
    if (invalid.length > 0) {
      return errorResult(
        `Columnas no válidas: ${invalid.join(", ")}. Solo se aceptan nombres simples de columna de esta tabla; ` +
          `no se pueden traer tablas relacionadas desde aquí.`,
      );
    }
    const badFilterCols = [
      ...(filters ?? []).map((f) => f.column.trim()),
      ...(order_by ? [order_by.trim()] : []),
    ].filter((c) => !COLUMN_RE.test(c));
    if (badFilterCols.length > 0) {
      return errorResult(`Columnas no válidas en filtros u ordenamiento: ${badFilterCols.join(", ")}.`);
    }

    const sb = sbForUser(ctx);
    // PostgREST's generated filter union is not callable through a dynamic
    // operator name; the builder is intentionally widened to its runtime shape.
    type AnyFilter = Record<string, (col: string, value: unknown) => AnyFilter> & {
      order: (col: string, opts: { ascending: boolean }) => AnyFilter;
      then: PromiseLike<{ data: unknown; error: { message: string } | null }>["then"];
    };
    let q = sb.from(name).select(requested.join(",")).limit(limit ?? 50) as unknown as AnyFilter;


    for (const f of filters ?? []) {
      const col = f.column.trim();
      const v = f.value;
      switch (f.op) {
        case "in":
          q = q.in(col, v.split(",").map((s) => s.trim()).filter(Boolean));
          break;
        case "is":
          q = q.is(col, v === "null" ? null : v === "true");
          break;
        default:
          q = q[f.op](col, v);
      }
    }
    if (order_by) q = q.order(order_by.trim(), { ascending: descending === false });

    const { data, error } = await (q as unknown as PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>);
    if (error) return errorResult(`Consulta rechazada: ${error.message}`);

    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return textResult(`${rows.length} fila(s) de ${name}.`, {
      tabla: name,
      total: rows.length,
      filas: rows,
      nota: "Resultados limitados por RLS a lo que tu usuario puede ver.",
    });
  },
});
