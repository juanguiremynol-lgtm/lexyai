// Static contract checks for the versioned mcp_list_freshness_issues definition.
// These are text-level checks of the release artifact, NOT OAuth or RLS execution tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const install = readFileSync("supabase/release/mcp_freshness_issues_install_20261114.sql", "utf8");
const rollback = readFileSync("supabase/release/mcp_freshness_issues_rollback_20261114.sql", "utf8");
const body = install.split("$body$")[1];

describe("mcp_list_freshness_issues versioned definition", () => {
  it("keeps signature and invoker mode (no SECURITY DEFINER)", () => {
    expect(body).toContain("mcp_list_freshness_issues(p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_work_item_id uuid DEFAULT NULL::uuid)");
    expect(body).not.toMatch(/SECURITY DEFINER/i);
    expect(install).toContain("must remain SECURITY INVOKER");
    expect(install).toMatch(/has_function_privilege\('anon'/);
  });
  it("aborts on unknown versions and targets the verified hash", () => {
    expect(install).toContain("unknown mcp_list_freshness_issues version");
    expect(install).toContain("'4bd7db655d8b4258749ed903cee3a391'");
    expect(rollback).toContain("'0fa53a1746f17f2bf5532fdb3510879a'");
    expect(rollback).toContain("DO NOT RUN");
  });
  it("scopes to ACTIVE monitored rows and excludes none/unknown providers", () => {
    expect(body).toContain("w.deleted_at IS NULL AND w.lifecycle_state='ACTIVE' AND w.monitoring_enabled");
    expect(body).toContain("NOT IN ('','unknown','none')");
    expect(body).toContain("RAISE EXCEPTION 'not authenticated'");
  });
  it("sanitizes upstream blocker fields with strict patterns", () => {
    expect(body).toContain("~ '^[A-Z][A-Z0-9_]{0,99}$'");
    expect(body).toContain("~ '^[0-9a-f-]{36}$'");
    expect(body).toContain("~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(body).toContain("left(l.metadata->'stored_result_read'->>'status',40)");
  });
  it("lists success with incomplete PP daily plan and never marks it full", () => {
    expect(body).toContain("l.provider='publicaciones' AND l.status='success' AND (l.metadata->'pp_window'->>'daily_plan_complete') IS DISTINCT FROM 'true'");
    expect(body).toContain("l.metadata->'pp_window'->>'daily_plan_complete'='true') ELSE NULL END");
  });
});
