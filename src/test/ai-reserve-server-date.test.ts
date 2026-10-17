/**
 * Regression: the daily AI reservation must be anchored to the CURRENT
 * Bogotá day computed server-side, never to a caller-supplied date.
 * Historical audit runs (input.run_date) share today's single reservation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    __dirname,
    "../../drizzle/migrations/0041_atenia_ai_reserve_uses_server_bogota_date.sql",
  ),
  "utf8",
);

describe("daily AI reservation uses the server Bogotá date", () => {
  it("the RPC computes usage_date from now() in America/Bogota", () => {
    expect(migration).toContain("(now() at time zone 'America/Bogota')::date");
  });

  it("the caller-supplied _usage_date is ignored (documented in the migration)", () => {
    expect(migration.replace(/\s+/g, " ")).toContain("_usage_date is kept in the signature for caller compatibility but ignored");
    // The INSERT must not reference the parameter
    const insert = migration.slice(migration.indexOf("insert into"));
    expect(insert).not.toContain("values (_org_id, _usage_date");
  });

  it("the uniqueness guard still scopes one reservation per org/day/caller", () => {
    expect(migration).toContain("on conflict (organization_id, usage_date, caller) do nothing");
  });

  it("the RPC remains service-role only", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.atenia_ai_reserve_daily_ai(uuid, date, text) FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.atenia_ai_reserve_daily_ai(uuid, date, text) TO service_role");
  });
});
