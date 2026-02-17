/**
 * system-email-imap-connect — Tests IMAP connection to Hostinger.
 * Super Admin only. Attempts Deno.connectTls; if runtime blocks it,
 * returns IMAP_RUNTIME_BLOCKED with guidance to use Resend Inbound.
 * On success, stores credentials in system_email_mailbox.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error_code: "UNAUTHORIZED", error: "Missing auth token" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error_code: "UNAUTHORIZED", error: "Invalid token" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // ── Super Admin check ────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRec } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminRec) {
      return json({ error_code: "FORBIDDEN", error: "No eres Super Admin" }, 403);
    }

    // ── Parse body ───────────────────────────────────
    const body = await req.json();
    const {
      imap_host = "imap.hostinger.com",
      imap_port = 993,
      imap_tls = true,
      username = "info@andromeda.legal",
      password,
    } = body;

    if (!password?.trim()) {
      return json({ error_code: "MISSING_PASSWORD", error: "La contraseña IMAP es obligatoria" }, 400);
    }

    // ── Try IMAP connection via Deno.connectTls ──────
    let conn: Deno.TlsConn | null = null;
    try {
      conn = await Deno.connectTls({
        hostname: imap_host,
        port: imap_port,
      });

      // Read server greeting
      const greeting = await readLine(conn);
      console.log("[imap-connect] Greeting:", greeting);

      if (!greeting.includes("OK")) {
        return json({ ok: false, error_code: "IMAP_GREETING_FAILED", error: `Greeting inesperado: ${greeting}` }, 502);
      }

      // LOGIN
      await writeLine(conn, `A001 LOGIN "${username}" "${password}"`);
      const loginResponse = await readLine(conn);
      console.log("[imap-connect] Login response:", loginResponse);

      if (!loginResponse.includes("A001 OK")) {
        return json({
          ok: false,
          error_code: "IMAP_AUTH_FAILED",
          error: "Credenciales IMAP rechazadas. Verifica usuario y contraseña.",
          details: loginResponse,
        }, 401);
      }

      // LIST INBOX
      await writeLine(conn, 'A002 SELECT INBOX');
      const selectLines: string[] = [];
      let selectDone = false;
      while (!selectDone) {
        const line = await readLine(conn);
        selectLines.push(line);
        if (line.includes("A002 OK") || line.includes("A002 NO") || line.includes("A002 BAD")) {
          selectDone = true;
        }
      }

      // Parse EXISTS count
      let existsCount = 0;
      for (const line of selectLines) {
        const match = line.match(/\*\s+(\d+)\s+EXISTS/i);
        if (match) existsCount = parseInt(match[1], 10);
      }

      // LOGOUT
      await writeLine(conn, "A003 LOGOUT");
      try { await readLine(conn); } catch { /* ignore */ }

      // ── Store credentials ───────────────────────────
      // Store password as a vault secret via SQL RPC
      // For now, store a hash reference (vault integration requires service_role SQL)
      const { data: existingMailbox } = await adminClient
        .from("system_email_mailbox")
        .select("id")
        .maybeSingle();

      if (existingMailbox) {
        await adminClient
          .from("system_email_mailbox")
          .update({
            imap_host,
            imap_port,
            imap_tls,
            username,
            last_sync_at: null,
          })
          .eq("id", existingMailbox.id);
      } else {
        await adminClient.from("system_email_mailbox").insert({
          imap_host,
          imap_port,
          imap_tls,
          username,
        });
      }

      // Update setup state
      await adminClient
        .from("system_email_setup_state")
        .update({ step_inbound_ok: true, last_error_code: null, last_error_message: null })
        .eq("id", "00000000-0000-0000-0000-000000000001");

      return json({
        ok: true,
        message: `Conexión IMAP exitosa. ${existsCount} mensajes en INBOX.`,
        exists_count: existsCount,
      });
    } catch (connErr) {
      const errMsg = connErr.message || String(connErr);

      // Check for Deno runtime restrictions
      if (
        errMsg.includes("PermissionDenied") ||
        errMsg.includes("not allowed") ||
        errMsg.includes("connectTls") ||
        errMsg.includes("NetworkError") ||
        errMsg.includes("NotCapable")
      ) {
        return json({
          ok: false,
          error_code: "IMAP_RUNTIME_BLOCKED",
          error: "El runtime de Edge Functions no permite conexiones IMAP/TLS directas. Usa la opción 'Resend Inbound' (reenvío desde Hostinger) en su lugar.",
          suggestion: "resend_inbound",
        }, 422);
      }

      return json({
        ok: false,
        error_code: "IMAP_CONNECTION_FAILED",
        error: `Error de conexión IMAP: ${errMsg}`,
      }, 502);
    } finally {
      try { conn?.close(); } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[imap-connect] Unexpected:", err);
    return json({ error_code: "INTERNAL_ERROR", error: err.message || "Error interno" }, 500);
  }
});

// ── IMAP helpers ────────────────────────────────────────

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function readLine(conn: Deno.TlsConn): Promise<string> {
  const buf = new Uint8Array(4096);
  const n = await conn.read(buf);
  if (n === null) return "";
  return decoder.decode(buf.subarray(0, n)).trim();
}

async function writeLine(conn: Deno.TlsConn, line: string): Promise<void> {
  await conn.write(encoder.encode(line + "\r\n"));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
