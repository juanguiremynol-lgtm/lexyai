/**
 * WhatsApp Check Secrets — reports which Meta secrets are present.
 * Only returns booleans (never the values).
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.3";

const REQUIRED = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response("unauthorized", { status: 401 });
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } },
  );
  const { data: userRes } = await userClient.auth.getUser();
  if (!userRes?.user) return new Response("unauthorized", { status: 401 });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: pa } = await sb.from("platform_admins").select("user_id").eq("user_id", userRes.user.id).maybeSingle();
  if (!pa) return new Response("forbidden", { status: 403 });

  const secrets: Record<string, boolean> = {};
  for (const name of REQUIRED) secrets[name] = Boolean(Deno.env.get(name));

  return new Response(JSON.stringify({ secrets }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
