import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { bogotaToday, errorResult, requireAuth, sbForUser, textResult } from "../shared";

const WINDOW_DAYS: Record<string, number> = { today: 1, "3days": 3, week: 7 };

/**
 * "Actuaciones de hoy" has three legitimate meanings, and they are NOT the
 * same set:
 *
 *  - `detectadas`  — detected_at inside the window (what the sidebar badge
 *                    and the daily digest count, each with its OWN extra
 *                    filters — see `comparabilidad` in the payload).
 *  - `fechadas`    — act_date inside the window (the court's legal date).
 *  - `ambas`       — the union.
 *
 * CLASSIFICATION IS A PROPERTY OF THE ROW, NOT OF THE QUERY. An earlier
 * version derived it from which query had returned the id, so in the default
 * mode every row came back flagged as a late detection. Each row is now
 * classified from its own `detected_at` and `act_date` against the window,
 * whichever query fetched it. A late detection requires BOTH a detection
 * inside the window AND a known act_date strictly before the window starts —
 * a future or missing act_date is never "late".
 */
const SELECT = "id, work_item_id, act_date, act_type, description, event_summary, despacho, source, detected_at";

type Row = Record<string, unknown>;

export default defineTool({
  name: "get_actuaciones_hoy",
  title: "Actuaciones recientes de la cartera",
  description:
    "Lists actuaciones across the whole portfolio within a recent window (today, last 3 days, or last week) in America/Bogota. `basis` chooses which rows are returned: `detectadas` (detected_at, DEFAULT), `fechadas` (act_date, the court's own date) or `ambas` (the union). Every returned row is classified from its own dates, independently of the query that fetched it. Counts are over the rows actually returned; `parcial` says when the limit truncated them. These numbers are NOT expected to equal the daily digest or the sidebar badge, which apply extra filters of their own.",
  inputSchema: {
    date: z.string().optional().describe("Día final YYYY-MM-DD en America/Bogota. Default: hoy."),
    window: z.enum(["today", "3days", "week"]).optional().describe("Ventana hacia atrás. Default: today."),
    basis: z
      .enum(["detectadas", "fechadas", "ambas"])
      .optional()
      .describe("Qué filas se devuelven: detectadas (default), fechadas (act_date) o ambas."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de filas devueltas en total (default 100)."),
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
    const startMs = Date.parse(startUTC);
    const endMs = Date.parse(endUTC);

    const cap = limit ?? 100;
    const mode = basis ?? "detectadas";
    const wantDetected = mode !== "fechadas";
    const wantDated = mode !== "detectadas";

    // One extra row per query so the global "hay_mas" is a fact, not a guess.
    const byId = new Map<string, Row>();

    if (wantDetected) {
      const { data, error } = await sb
        .from("work_item_acts")
        .select(SELECT)
        .gte("detected_at", startUTC)
        .lte("detected_at", endUTC)
        .or("is_archived.is.null,is_archived.eq.false")
        .order("detected_at", { ascending: false })
        .limit(cap + 1);
      if (error) return errorResult(error.message);
      for (const r of (data ?? []) as Row[]) byId.set(String(r.id), r);
    }

    if (wantDated) {
      const { data, error } = await sb
        .from("work_item_acts")
        .select(SELECT)
        .gte("act_date", from)
        .lte("act_date", end)
        .or("is_archived.is.null,is_archived.eq.false")
        .order("act_date", { ascending: false })
        .limit(cap + 1);
      if (error) return errorResult(error.message);
      for (const r of (data ?? []) as Row[]) byId.set(String(r.id), r);
    }

    // Global limit over the UNION: applying it per query returned more rows
    // than the caller asked for whenever both queries ran.
    const union = [...byId.values()].sort((a, b) =>
      String(b.detected_at ?? "").localeCompare(String(a.detected_at ?? "")),
    );
    const hayMas = union.length > cap;
    const page = union.slice(0, cap);

    const ids = [...new Set(page.map((r) => String(r.work_item_id)))];
    const { data: items } = ids.length
      ? await sb.from("work_items").select("id, radicado, title, workflow_type").in("id", ids).is("deleted_at", null)
      : { data: [] as Row[] };
    const wiById = new Map<string, Row>(
      (items ?? []).map((i) => [String((i as Row).id), i as Row] as [string, Row]),
    );

    const rows: Row[] = page.map((r) => {
      const detMs = r.detected_at ? Date.parse(String(r.detected_at)) : NaN;
      const detectadaEnVentana = Number.isFinite(detMs) && detMs >= startMs && detMs <= endMs;
      const actDate = r.act_date ? String(r.act_date).slice(0, 10) : null;
      const fechadaEnVentana = actDate !== null && actDate >= from && actDate <= end;
      // Strictly before the window: a future or unknown act_date is not late.
      const tardia = detectadaEnVentana && actDate !== null && actDate < from;
      const out: Row = {
        ...r,
        work_item: wiById.get(String(r.work_item_id)) ?? null,
        detectada_en_ventana: detectadaEnVentana,
        fechada_en_ventana: fechadaEnVentana,
        deteccion_tardia: tardia,
        clasificacion:
          detectadaEnVentana && fechadaEnVentana
            ? "fechada_y_detectada_en_ventana"
            : detectadaEnVentana
              ? tardia
                ? "detectada_en_ventana_con_fecha_anterior"
                : actDate === null
                  ? "detectada_en_ventana_sin_fecha"
                  : "detectada_en_ventana_con_fecha_posterior"
              : "fechada_en_ventana",
      };
      return out;
    });

    const detectadas = rows.filter((r) => r.detectada_en_ventana).length;
    const fechadas = rows.filter((r) => r.fechada_en_ventana).length;
    const tardias = rows.filter((r) => r.deteccion_tardia).length;
    const sinFecha = rows.filter((r) => !r.act_date).length;

    return textResult(
      `${rows.length} actuación(es) entre ${from} y ${end} (America/Bogota), criterio "${mode}": ${detectadas} detectada(s) en la ventana, ${fechadas} con fecha del juzgado en la ventana, ${tardias} detección(es) tardía(s)${hayMas ? ` — tope de ${cap} alcanzado, los conteos son parciales` : ""}.`,
      {
        date_from: from,
        date_to: end,
        basis: mode,
        limit: cap,
        hay_mas: hayMas,
        parcial: hayMas,
        conteos: {
          filas_devueltas: rows.length,
          detectadas_en_ventana: detectadas,
          fechadas_en_ventana: fechadas,
          detecciones_tardias: tardias,
          sin_fecha_del_juzgado: sinFecha,
        },
        definiciones: {
          detectadas_en_ventana: "detected_at dentro de la ventana.",
          fechadas_en_ventana: "act_date (fecha del juzgado) dentro de la ventana.",
          detecciones_tardias:
            "detectada dentro de la ventana Y con fecha del juzgado conocida anterior al inicio de la ventana. Una fecha futura o ausente nunca cuenta como tardía.",
          parcial: "true cuando el tope de filas truncó el resultado: los conteos son de la muestra, no del total.",
        },
        comparabilidad:
          "Estas cifras se calculan solo sobre esta ventana y sin los filtros propios del correo diario (asuntos en la vista de monitoreo, novedades notificables y no despachadas por otro canal) ni del contador lateral. Un número distinto al del correo no implica un error: para compararlos hay que igualar ventana y filtros.",
        actuaciones: rows,
      },
    );
  },
});
