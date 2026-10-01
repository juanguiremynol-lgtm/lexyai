// deno-lint-ignore-file no-explicit-any
/**
 * calendar-ics — downloads a single .ics for a term or hearing from a digest
 * link (?t=<opaque token>). Read-only; never creates events in external accounts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type CalendarStore, resolveIcs } from "./handler.ts";

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("Método no permitido", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const one = async (q: any) => (await q.maybeSingle()).data ?? null;
  const store: CalendarStore = {
    token: (t) => one(sb.from("calendar_event_tokens").select("*").eq("token", t)),
    workItem: (id) => one(sb.from("work_items").select("id, owner_id, radicado, authority_name").eq("id", id)),
    term: (id) => one(sb.from("work_item_deadlines").select("id, work_item_id, status, deadline_date, label, deadline_type").eq("id", id)),
    hearing: (id) => one(sb.from("work_item_hearings").select("id, work_item_id, scheduled_at, status, custom_name, location, duration_minutes").eq("id", id)),
    bump: async (t) => {
      const cur = await one(sb.from("calendar_event_tokens").select("use_count").eq("token", t));
      await sb.from("calendar_event_tokens").update({ use_count: (cur?.use_count ?? 0) + 1 }).eq("token", t);
    },
  };
  try {
    const r = await resolveIcs(new URL(req.url).searchParams.get("t"), store);
    if (r.status !== 200) {
      return new Response(r.body, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return new Response(r.body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${r.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (_e) {
    return new Response("Error interno.", { status: 500 });
  }
});
