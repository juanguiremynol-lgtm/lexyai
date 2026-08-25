import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const migrations = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"));

const SS_MIGRATION = migrations.find(
  (sql) =>
    sql.includes("CREATE OR REPLACE VIEW public.monitoring_coverage_v") &&
    sql.includes("supersede_work_item_alerts_on_delete"),
);

describe("SS · alert condition lifecycle", () => {
  it("derives provider expectations from the canonical routing function", () => {
    expect(SS_MIGRATION).toBeDefined();
    expect(SS_MIGRATION).toContain("provider_chain_for_workflow(w.workflow_type::text)");
    expect(SS_MIGRATION).not.toMatch(/ARRAY\['tutelas'\]/);
  });

  it("classifies successful empty histories as never ingested, not stale", () => {
    expect(SS_MIGRATION).toContain("rc.act_count = 0 AND rc.publication_count = 0 AND ru.last_ok_run IS NOT NULL");
    expect(SS_MIGRATION).toContain("THEN 'NUNCA_INGERIDO'");
    expect(SS_MIGRATION).not.toContain("days_since_ingest >= p_threshold_days");
  });

  it("does not create an alert for quiet matters that already have history", () => {
    expect(SS_MIGRATION).toMatch(/coverage_status IN \([\s\S]*'NUNCA_INGERIDO'[\s\S]*\)/);
    expect(SS_MIGRATION).not.toMatch(/coverage_status IN \([\s\S]*'QUIET'[\s\S]*\)/);
  });

  it("supersedes open alerts in the same transaction when a matter is deleted", () => {
    expect(SS_MIGRATION).toContain("CREATE TRIGGER trg_supersede_work_item_alerts_on_delete");
    expect(SS_MIGRATION).toContain("NEW.deleted_at IS NOT NULL");
    expect(SS_MIGRATION).toContain("status = 'SUPERSEDED'");
    expect(SS_MIGRATION).toContain("dismissal_reason = 'WORK_ITEM_DELETED'");
  });

  it("auto-resolves email alerts only after the connection recovers", () => {
    expect(SS_MIGRATION).toContain("a.alert_type = 'EMAIL_CONEXION_ERROR'");
    expect(SS_MIGRATION).toContain("c.status = 'CONNECTED'");
    expect(SS_MIGRATION).toContain("c.revoked_at IS NULL");
    expect(SS_MIGRATION).toContain("'EMAIL_CONNECTION_RECOVERED'");
  });
});