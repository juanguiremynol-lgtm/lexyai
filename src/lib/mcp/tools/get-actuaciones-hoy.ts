import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, errorResult, requireAuth, sbForUser, textResult } from "../shared";

const WINDOW_DAYS: Record<string, number> = { today: 1, "3days": 3, week: 7 };

/**
 * "Actuaciones de hoy" has three legitimate meanings, and they are NOT the
 * same set. This tool names them explicitly instead of silently picking one:
 *
 *  - `detectadas`  — detected_at inside the window. This is the CANONICAL feed:
 *                    the sidebar badge (use-hoy-counts) and the daily digest
 *                    both count exactly this.
 *  - `fechadas`    — act_date inside the window (the court's legal date).
 *  - `ambas`       — the union, each row tagged; rows detected in the window
 *                    whose act_date is older are flagged `deteccion_tardia`.
 */
const SELECT = "id, work_item_id, act_date, act_type, description, event_summary, despacho, source, detected_at";

type Row = Record<string, unknown>;

export default defineTool({
  name: "get_actuaciones_hoy",
  title: "Actuaciones recientes de la cartera",
  description:
    "Lists actuaciones across the whole portfolio within a recent window (today, last 3 days, or last week) in America/Bogota. `basis` chooses the meaning: `detectadas` (detected_at — the canonical feed used by the sidebar badge and the daily digest, DEFAULT), `fechadas` (act_date, the court's own date), or `ambas` (union, each row tagged, with late detections flagged).",
  inputSchema: {
    date: z.string().optional().describe("Día final YYYY-MM-DD en America/Bogota. Default: hoy."),
    window: z.enum(["today", "3days", "week"]).optional().describe("Ventana hacia atrás. Default: today."),
    basis: z
      .enum(["detectadas", "fechadas", "ambas"])
      .optional()
      .describe("Qué significa 'de hoy': detectadas (default, canónico), fechadas (act_date) o ambas."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ date, window, basis, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);

    const end = date ?? bogotaToday();
    const days = WINDOW_DAYS[window ?? "today"];
    const start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const from = start.toISOString().slice(0, 10);

    // Bogota calendar window expressed in absolute time for detected_at.
    const startUTC = new Date(`${from}T00:00:00-05:00`).toISOString();
    const endUTC = new Date(`${end}T23:59:59.999-05:00`).toISOString();

    const cap = limit ?? 100;
    const mode = basis ?? "detectadas";
    const wantDetected = mode !== "fechadas";
    const wantDated = mode !== "detectadas";

    const byId = new Map<string, Row>();
    const detectedIds = new Set<string>();
    const datedIds = new Set<string>();

    if (wantDetected) {
      const { data, error } = await sb
        .from("work_item_acts")
        .select(SELECT)
        .gte("detected_at", startUTC)
        .lte("detected_at", endUTC)
        .or("is_archived.is.null,is_archived.eq.false")
        .order("detected_at", { ascending: false })
        .limit(cap);
      if (error) return errorResult(error.message);
      for (const r of (data ?? []) as Row[]) {
        byId.set(String(r.id), r);
        detectedIds.add(String(r.id));
      }
    }

    if (wantDated) {
      const { data, error } = await sb
        .from("work_item_acts")
        .select(SELECT)
        .gte("act_date", from)
        .lte("act_date", end)
        .or("is_archived.is.null,is_archived.eq.false")
        .order("act_date", { ascending: false })
        .limit(cap);
      if (error) return errorResult(error.message);
      for (const r of (data ?? []) as Row[]) {
        byId.set(String(r.id), r);
        datedIds.add(String(r.id));
      }
    }

    const ids = [...new Set([...byId.values()].map((r) => String(r.work_item_id)))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type").in("id", ids).is("deleted_at", null)
      : { data: [] as Row[] };
    const wiById = new Map<string, Row>((items ?? []).map((i) => [String((i as Row).id), i as Row]));

    const rows = [...byId.values()]
      .map((r) => {
        const id = String(r.id);
        const detectada = detectedIds.has(id);
        const fechada = datedIds.has(id);
        return {
          ...r,
          work_item: wiById.get(String(r.work_item_id)) ?? null,
          clasificacion: detectada && fechada ? "fechada_y_detectada_hoy" : detectada ? "detectada_hoy" : "fechada_hoy",
          deteccion_tardia: detectada && !fechada,
        };
      })
      .sort((a, b) => String(b.detected_at ?? "").localeCompare(String(a.detected_at ?? "")));

    const detectadas = rows.filter((r) => r.clasificacion !== "fechada_hoy").length;
    const fechadas = rows.filter((r) => r.clasificacion !== "detectada_hoy").length;
    const tardias = rows.filter((r) => r.deteccion_tardia).length;

    return textResult(
      `${rows.length} actuación(es) entre ${from} y ${end} (America/Bogota), criterio "${mode}": ${detectadas} detectada(s) en la ventana, ${fechadas} con fecha del juzgado en la ventana, ${tardias} detección(es) tardía(s).`,
      {
        date_from: from,
        date_to: end,
        basis: mode,
        conteos: { detectadas_en_ventana: detectadas, fechadas_en_ventana: fechadas, detecciones_tardias: tardias },
        definiciones: {
          detectadas_en_ventana: "detected_at dentro de la ventana — es lo que cuentan el badge lateral y el correo diario.",
          fechadas_en_ventana: "act_date (fecha del juzgado) dentro de la ventana.",
          detecciones_tardias: "detectada en la ventana pero con fecha del juzgado anterior.",
        },
        actuaciones: rows,
      },
    );
  },
});
