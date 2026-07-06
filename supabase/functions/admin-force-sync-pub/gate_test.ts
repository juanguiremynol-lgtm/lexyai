/**
 * Phase 2 Step 1 gate — verifies that a forced sync of the target CPACA work
 * item now goes through the shared samaiEstadosAdapter and reports a non-zero
 * samai_raw_count for radicado 05001233300020240115300.
 *
 * Runs against the deployed function using ADMIN_FORCE_SYNC_TOKEN from the
 * function environment.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL =
  Deno.env.get("VITE_SUPABASE_URL") ||
  Deno.env.get("SUPABASE_URL") ||
  "https://qvuukbqcvlnvmcvcruji.supabase.co";
const ADMIN_TOKEN = Deno.env.get("ADMIN_FORCE_SYNC_TOKEN")!;
const TARGET_WI = "2a590db7-0330-4b8d-9403-5963e4bd15a1";

Deno.test("gate: SAMAI Estados returns raw_count >= 1 for target CPACA work_item", async () => {
  const resp = await fetch(
    `${SUPABASE_URL}/functions/v1/admin-force-sync-pub`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ work_item_id: TARGET_WI }),
    },
  );
  const text = await resp.text();
  console.log("admin-force-sync-pub response:", text);
  assertEquals(resp.status, 200, `expected 200, got ${resp.status}: ${text}`);
  const outer = JSON.parse(text);
  const inner = outer.result;
  console.log("SAMAI summary:", JSON.stringify(inner?.samai_estados_summary, null, 2));
  console.log("result_code:", inner?.result_code);
  console.log("inserted:", inner?.inserted_count, "skipped:", inner?.skipped_count);
  assert(inner, "inner sync result missing");
  const samai = inner.samai_estados_summary;
  assert(samai?.called, "SAMAI Estados adapter was not invoked");
  assert(
    (samai.raw_count ?? 0) >= 1,
    `expected samai raw_count >= 1, got ${samai.raw_count} (status=${samai.status}, http=${samai.http_status}, err=${samai.error})`,
  );
});