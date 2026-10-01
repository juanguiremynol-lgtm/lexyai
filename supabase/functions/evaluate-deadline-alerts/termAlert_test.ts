import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type TermAlertStore, upsertTermAlertCore } from "./termAlert.ts";
import { normalizeAlertPrefs } from "../_shared/alertPreferences.ts";

function memStore() {
  const rows: any[] = [];
  let n = 0;
  const store: TermAlertStore = {
    findByDeadline: async (id) => rows.filter((r) => r.payload?.deadline_id === id),
    insert: async (row) => { rows.push({ id: `a${++n}`, created_at: String(n), ...row }); return null; },
    update: async (id, patch) => { Object.assign(rows.find((r) => r.id === id), patch); return null; },
  };
  return { rows, store };
}
const args = (bucket: string, alertType: string, severity: string) => ({
  deadlineId: "D1", ownerId: "O", organizationId: null, workItemId: "W", alertType, severity,
  title: bucket, message: null, payload: { deadline_id: "D1", bucket },
});

Deno.test("two runs same day, same term → one alert_instance", async () => {
  const { rows, store } = memStore();
  await upsertTermAlertCore(store, args("D-3", "TERMINO_CRITICO", "CRITICAL"));
  await upsertTermAlertCore(store, args("D-3", "TERMINO_CRITICO", "CRITICAL"));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].payload.escalation_history.length, 1);
});

Deno.test("milestones D-8 → D-3 → D-1 → D-DAY → OVERDUE ×3 → one row + history, no daily repeat", async () => {
  const { rows, store } = memStore();
  const seq: [string, string, string][] = [
    ["D-8", "TERMINO_POR_VENCER", "WARNING"], ["D-3", "TERMINO_CRITICO", "CRITICAL"],
    ["D-1", "TERMINO_CRITICO", "CRITICAL"], ["D-DAY", "TERMINO_CRITICO", "CRITICAL"],
    ["OVERDUE", "TERMINO_VENCIDO", "CRITICAL"], ["OVERDUE", "TERMINO_VENCIDO", "CRITICAL"], ["OVERDUE", "TERMINO_VENCIDO", "CRITICAL"],
  ];
  for (const [b, t, s] of seq) await upsertTermAlertCore(store, args(b, t, s));
  assertEquals(rows.length, 1);
  assertEquals(rows[0].alert_type, "TERMINO_VENCIDO");
  assertEquals(rows[0].payload.escalation_history.map((h: any) => h.to_bucket), ["D-8", "D-3", "D-1", "D-DAY", "OVERDUE"]);
});

Deno.test("closed alert is never resurrected; muted milestone does not insert", async () => {
  const { rows, store } = memStore();
  await upsertTermAlertCore(store, args("D-3", "TERMINO_CRITICO", "CRITICAL"));
  rows[0].status = "DISMISSED";
  const r = await upsertTermAlertCore(store, args("D-1", "TERMINO_CRITICO", "CRITICAL"));
  assertEquals(r.outcome, "closed_by_lawyer");
  assertEquals(rows.length, 1);
  const m = memStore();
  const r2 = await upsertTermAlertCore(m.store, { ...args("D-8", "TERMINO_POR_VENCER", "WARNING"), allowInsert: false });
  assertEquals(r2.outcome, "muted_by_preference");
  assertEquals(m.rows.length, 0);
});

Deno.test("preferences: no row → defaults; unknown milestones dropped", () => {
  assertEquals(normalizeAlertPrefs(null), { term_milestones: ["D-8", "D-3", "D-1", "D-DAY"], overdue: true, manual_review_info: true });
  assertEquals(normalizeAlertPrefs({ term_milestones: ["D-3", "D-10"], overdue: false }).term_milestones, ["D-3"]);
});

Deno.test("milestones use the injected SQL calendar (holiday 12/10/2026), never weekend-only", async () => {
  const { businessDaysRemaining, bucketFor } = await import("./termAlert.ts");
  const hol = new Set(["2026-10-12"]);
  const rpc = async (a: string, b: string) => { // stand-in for business_days_between_sql
    let n = 0; const d = new Date(a + "T00:00:00Z"); const e = new Date(b + "T00:00:00Z");
    while (d < e) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); const iso = d.toISOString().slice(0, 10);
      if (w !== 0 && w !== 6 && !hol.has(iso)) n++; }
    return n;
  };
  const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
  eq(await businessDaysRemaining(rpc, "2026-10-01", "2026-10-14"), 8); eq(bucketFor(8), "D-8");
  eq(await businessDaysRemaining(rpc, "2026-10-09", "2026-10-13"), 1); eq(bucketFor(1), "D-1");
  eq(await businessDaysRemaining(rpc, "2026-10-09", "2026-10-14"), 2); eq(bucketFor(2), "D-3");
  eq(await businessDaysRemaining(rpc, "2026-10-14", "2026-10-09"), -2); eq(bucketFor(-2), "OVERDUE");
  eq(await businessDaysRemaining(rpc, "2026-10-13", "2026-10-13"), 0); eq(bucketFor(0), "D-DAY");
  eq(await businessDaysRemaining(async () => null, "2026-10-01", "2026-10-05"), null);
});

Deno.test("manual review alert type is INFO-only and not an urgency type", async () => {
  const { MANUAL_REVIEW_ALERT_TYPE } = await import("./termAlert.ts");
  if (MANUAL_REVIEW_ALERT_TYPE !== "TERMINO_REVISION_MANUAL") throw new Error("type");
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  for (const bad of ["provisional_deadline_date", "addBusinessDays", "bdRemaining"]) if (src.includes(bad)) throw new Error(bad);
});

Deno.test("manual review: legacy POR_VENCER row is rewritten without provisional fields; muted pref retires it", async () => {
  const { upsertTermAlertCore, MANUAL_REVIEW_ALERT_TYPE } = await import("./termAlert.ts");
  const rows: any[] = [{ id: "a1", status: "PENDING", alert_type: "TERMINO_POR_VENCER", severity: "INFO",
    payload: { deadline_id: "m1", provisional_deadline_date: "2026-10-05", business_days_remaining: 2, bucket: "MANUAL_REVIEW" } }];
  const db = {
    findByDeadline: async () => rows,
    insert: async (r: any) => { rows.push({ id: "n", ...r }); return null; },
    update: async (id: string, patch: any) => { Object.assign(rows.find((r) => r.id === id), patch); return null; },
  };
  const base = { deadlineId: "m1", ownerId: "o", organizationId: null, workItemId: "w", alertType: MANUAL_REVIEW_ALERT_TYPE,
    severity: "INFO", title: "t", message: null, payload: { deadline_id: "m1", deadline_date: null, bucket: "MANUAL_REVIEW" } };
  await upsertTermAlertCore(db, { ...base, allowInsert: true, retireWhenMuted: true });
  if (rows.length !== 1 || rows[0].alert_type !== "TERMINO_REVISION_MANUAL" || rows[0].severity !== "INFO") throw new Error("type");
  for (const k of ["provisional_deadline_date", "business_days_remaining"]) if (k in rows[0].payload) throw new Error(k);
  const r = await upsertTermAlertCore(db, { ...base, allowInsert: false, retireWhenMuted: true });
  if (r.outcome !== "muted_by_preference" || rows[0].status !== "CANCELLED") throw new Error("retire");
});

Deno.test("attribution routing: PROPIO escalates, JUEZ/CONTRAPARTE none, DESCONOCIDO/AMBAS pending", async () => {
  const { attributionRoute } = await import("./termAlert.ts");
  const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
  eq(attributionRoute("PROPIO"), "OWN");
  eq(attributionRoute("JUEZ"), "NOT_OWN");
  eq(attributionRoute("CONTRAPARTE"), "NOT_OWN");
  eq(attributionRoute("DESCONOCIDO"), "ATTRIBUTION_PENDING");
  eq(attributionRoute("AMBAS"), "ATTRIBUTION_PENDING");
  eq(attributionRoute(null), "ATTRIBUTION_PENDING");
});

Deno.test("DESCONOCIDO: one stable INFO notice across repeated runs, no burden wording, no escalation", async () => {
  const { upsertTermAlertCore, attributionPendingNotice, TERM_ALERT_TYPES } = await import("./termAlert.ts");
  const rows: any[] = [];
  const db = {
    findByDeadline: async (id: string) => rows.filter((r) => r.payload.deadline_id === id),
    insert: async (r: any) => { rows.push({ id: `r${rows.length}`, ...r }); return null; },
    update: async (id: string, p: any) => { Object.assign(rows.find((r) => r.id === id), p); return null; },
  };
  const d = { id: "7b1b6202", deadline_type: "TRASLADO", deadline_date: "2026-10-15", label: "Traslado", attribution: "DESCONOCIDO" };
  for (let i = 0; i < 3; i++) {
    const n = attributionPendingNotice(d);
    await upsertTermAlertCore(db, { deadlineId: d.id, ownerId: "o", organizationId: null, workItemId: "w", allowInsert: true, retireWhenMuted: true, ...n });
  }
  if (rows.length !== 1) throw new Error(`rows ${rows.length}`);
  const r = rows[0];
  if (r.alert_type !== "TERMINO_ATRIBUCION_PENDIENTE" || r.severity !== "INFO") throw new Error("type/sev");
  if (r.payload.escalation_history.length !== 1) throw new Error("escalated");
  if ("business_days_remaining" in r.payload) throw new Error("urgency field");
  if (!TERM_ALERT_TYPES.includes(r.alert_type)) throw new Error("not tracked");
  const text = `${r.title} ${r.message}`.toLowerCase();
  for (const bad of ["a su cargo", "su término", "debe ", "vence", "vencido", "sus términos"]) if (text.includes(bad)) throw new Error(bad);
  if (!text.includes("pending") || !text.includes("pendiente de validación por andromeda")) throw new Error("wording");
  // Muted preference retires it.
  await upsertTermAlertCore(db, { deadlineId: d.id, ownerId: "o", organizationId: null, workItemId: "w", allowInsert: false, retireWhenMuted: true, ...attributionPendingNotice(d) });
  if (rows[0].status !== "CANCELLED") throw new Error("not retired");
});

Deno.test("evaluator wires JUEZ/CONTRAPARTE to retire and never inserts for them", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!src.includes('route === "NOT_OWN"') || !src.includes("notOwnDeadlineIds.push")) throw new Error("wiring");
});
