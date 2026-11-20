import { selectEligibleWorkItems } from "../_shared/sync-eligibility.ts";
import { monitoredOrganizations, summarizeDryRun } from "./inventory.ts";

const radicado = "05001400302320250063800";
const candidates = Array.from({ length: 207 }, (_, i) => ({
  id: String(i).padStart(4, "0"), organization_id: "org-" + Math.floor(i / 30),
  workflow_type: "CGP", stage: null, radicado: i === 1 ? "incorrecto" : radicado,
  scraping_enabled: i !== 7,
  sync_item_failure_tracker: i === 3 ? { dead_lettered: true } : null,
}));

// The server may cap each response below the requested size, as in PostgREST.
function database(rows = candidates) {
  return { from: () => {
    let key = "id", after = "", limit = 4, scrapesOnly = false;
    const q: any = {
      select: () => q, is: () => q, in: () => q, or: () => q,
      eq: (field: string, value: unknown) => { if (field === "scraping_enabled") scrapesOnly = value === true; return q; },
      not: () => q, lte: () => q, returns: () => q,
      order: (name: string) => { key = name; return q; },
      gt: (_field: string, value: string) => { after = value; return q; },
      limit: (n: number) => { limit = Math.min(n, 4); return q; },
      then: (resolve: (v: unknown) => unknown) => {
        const field = key as "id" | "organization_id";
        const sorted = rows.filter(r => r[field] > after && (!scrapesOnly || r.scraping_enabled))
          .sort((a,b) => a[field].localeCompare(b[field]));
        return resolve({ data: sorted.slice(0, limit), error: null });
      },
    };
    return q;
  }} as any;
}

Deno.test("a mixed invalid page still fills the caller's page, and the uncapped inventory reads every raw page", async () => {
  const first = await selectEligibleWorkItems(database(), "org", { limit: 4 });
  if (first.map(x => x.id).join(",") !== "0000,0002,0003,0004") throw Error("truncated first page");
  const all = await selectEligibleWorkItems(database(), "org");
  if (all.length !== 205 || new Set(all.map(i=>i.id)).size !== 205 || all.some(x => x.id === "0007")) throw Error("eligibility mismatch");
});

Deno.test("diagnostic spans all organizations and includes items with a prior failure", async () => {
  const orgs = await monitoredOrganizations(database());
  const rows = await summarizeDryRun(database(), new Date().toISOString());
  if (orgs.length !== 7 || rows.length !== 7) throw Error("omitted organizations");
  if (rows.reduce((n,x) => n+x.eligible_count,0) !== 207) throw Error("omitted a candidate");
  if (rows.reduce((n,x) => n+x.would_enqueue_count,0) !== 205) throw Error("eligibility mismatch");
  if (rows[0].exclusion_reasons.invalid_radicado_format !== 1 || rows[0].exclusion_reasons.scraping_disabled !== 1 || rows[0].exclusion_reasons.dead_lettered) throw Error("wrong exclusion reason");
});

Deno.test("a failed diagnostic cannot fall through into a real collection, and reads cached preflight only", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const diagnostic = src.slice(src.indexOf("if (maybeBody?.dry_run)"), src.indexOf("const startTime = Date.now();"));
  if (!diagnostic.includes("DAILY_DIAGNOSTIC_UNAVAILABLE") || !diagnostic.includes("status: 503")) throw Error("missing diagnostic error boundary");
  if (diagnostic.includes("functions.invoke") || !diagnostic.includes('from("atenia_preflight_checks")')) throw Error("dry-run performed an active probe");
  if (!src.includes('delayed || totalErrors > 0 ? "PARTIAL"')) throw Error("delayed preflight reported as complete");
});
