/**
 * Temporary concurrency probe for public._admit_daily_update_at.
 * Runs concurrent PostgREST calls (separate DB sessions/transactions) against
 * an isolated far-future day only; never touches providers or real admissions.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: wi } = await db.from("work_items").select("id").not("owner_id", "is", null).limit(1).single();
  const rounds: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const d = `2099-01-0${i + 1}`;
    const call = (channel: string, hold: number) =>
      db.rpc("_daily_gate_probe_admit", { _d: d, _work_item_id: wi!.id, _channel: channel, _hold_ms: hold })
        .then((r) => r.data ?? { error: r.error?.message });
    // Session A holds its transaction open 1500 ms after admitting; B..D race it.
    const res = await Promise.all([call("acts", 1500), call("acts", 0), call("acts", 0), call("pubs", 0), call("pubs", 0)]);
    rounds.push({ run_date: d, results: res });
  }
  const { data: cleaned } = await db.rpc("_daily_gate_probe_cleanup");
  return new Response(JSON.stringify({ rounds, cleaned }), { headers: { "Content-Type": "application/json" } });
});
