/**
 * Regression: the supervisor report upsert must atomically preserve an
 * existing ai_diagnosis when the current run produced none (lost the daily
 * reservation, gemini disabled, or deterministic-only mode). A plain PostgREST
 * upsert would overwrite it with null — the race is closed in SQL.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const supervisor = readFileSync(
  resolve(__dirname, "../../supabase/functions/atenia-ai-supervisor/index.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    __dirname,
    "../../drizzle/migrations/0040_atenia_ai_report_upsert_preserves_diagnosis.sql",
  ),
  "utf8",
);

describe("report upsert preserves existing AI diagnosis atomically", () => {
  it("supervisor writes the report through the atomic RPC, not a plain upsert", () => {
    expect(supervisor).toContain('rpc("atenia_ai_upsert_report"');
    // No direct upsert on atenia_ai_reports remains in the report-write path
    const writes = supervisor.match(/from\("atenia_ai_reports"\)[\s\S]{0,120}/g) ?? [];
    for (const w of writes) expect(w).not.toContain(".upsert(");
  });

  it("SQL conflict path keeps the stored diagnosis when the new one is null", () => {
    expect(migration).toContain(
      "ai_diagnosis = COALESCE(EXCLUDED.ai_diagnosis, public.atenia_ai_reports.ai_diagnosis)",
    );
  });

  it("SQL conflict path still refreshes the deterministic metrics", () => {
    for (const col of [
      "total_work_items",
      "items_synced_ok",
      "items_failed",
      "diagnostics",
      "remediation_actions",
    ]) {
      expect(migration).toContain(`${col} = EXCLUDED.${col}`);
    }
  });

  it("the RPC is service-role only", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.atenia_ai_upsert_report(jsonb) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.atenia_ai_upsert_report(jsonb) TO service_role",
    );
  });
});
