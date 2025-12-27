import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =============================================
// TYPES
// =============================================

interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    from: string;
    to: string[];
    cc?: string[];
    subject: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      filename: string;
      content_type: string;
      size: number;
      content?: string; // base64
    }>;
  };
}

interface NormalizedMessage {
  source_provider: string;
  source_message_id: string | null;
  from_name: string | null;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  date_header: string | null;
  text_body: string | null;
  html_body: string | null;
  body_preview: string;
  thread_id: string | null;
  references_header: string[];
  in_reply_to: string | null;
  raw_payload_hash: string;
  attachments: Array<{
    filename: string;
    mime_type: string;
    size_bytes: number;
    content_base64?: string;
    is_inline: boolean;
  }>;
}

interface LinkCandidate {
  entity_type: "CLIENT" | "CGP_CASE" | "TUTELA" | "HABEAS_CORPUS" | "PROCESO_ADMINISTRATIVO";
  entity_id: string;
  confidence: number;
  reasons: string[];
  auto_link: boolean;
}

interface FilingRecord {
  id: string;
  filing_type: string;
  radicado: string | null;
  email_linking_enabled: boolean;
  court_email?: string | null;
  court_name?: string | null;
}

interface ProcessRecord {
  id: string;
  radicado: string | null;
  email_linking_enabled: boolean;
}

interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  email_linking_enabled: boolean;
}

// =============================================
// UTILITIES
// =============================================

async function hashPayload(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseEmailAddress(email: string): { name: string | null; address: string } {
  const match = email.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
  if (match) {
    return { name: match[1] || null, address: match[2].toLowerCase() };
  }
  return { name: null, address: email.toLowerCase() };
}

function extractBodyPreview(text: string | null, html: string | null): string {
  const content = text || html?.replace(/<[^>]*>/g, " ") || "";
  return content.substring(0, 200).replace(/\s+/g, " ").trim();
}

// Radicado pattern: XX-XXX-XX-XXXX-XXXX-XXXXX-XX (Colombian judicial)
const RADICADO_PATTERN = /\b(\d{2}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{3,4}[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2})\b/gi;

function extractRadicados(text: string): string[] {
  const matches = text.match(RADICADO_PATTERN) || [];
  return [...new Set(matches.map(r => r.replace(/[-\s]/g, "")))];
}

// =============================================
// ADAPTER: RESEND
// =============================================

function normalizeResendPayload(payload: ResendWebhookPayload, rawHash: string): NormalizedMessage {
  const fromParsed = parseEmailAddress(payload.data.from);
  
  return {
    source_provider: "RESEND",
    source_message_id: payload.data.email_id || null,
    from_name: fromParsed.name,
    from_email: fromParsed.address,
    to_emails: payload.data.to || [],
    cc_emails: payload.data.cc || [],
    subject: payload.data.subject || "(Sin asunto)",
    date_header: payload.created_at,
    text_body: payload.data.text || null,
    html_body: payload.data.html || null,
    body_preview: extractBodyPreview(payload.data.text || null, payload.data.html || null),
    thread_id: payload.data.headers?.["Message-ID"] || null,
    references_header: payload.data.headers?.["References"]?.split(/\s+/) || [],
    in_reply_to: payload.data.headers?.["In-Reply-To"] || null,
    raw_payload_hash: rawHash,
    attachments: (payload.data.attachments || []).map(att => ({
      filename: att.filename,
      mime_type: att.content_type,
      size_bytes: att.size,
      content_base64: att.content,
      is_inline: false,
    })),
  };
}

// =============================================
// LINKING PIPELINE
// =============================================

// deno-lint-ignore no-explicit-any
async function findLinkCandidates(
  supabase: any,
  ownerId: string,
  message: NormalizedMessage
): Promise<LinkCandidate[]> {
  const candidates: LinkCandidate[] = [];
  const searchText = `${message.subject} ${message.text_body || ""} ${message.from_email}`;

  // 1) Extract radicados and match CGP cases
  const radicados = extractRadicados(searchText);
  
  if (radicados.length > 0) {
    // Check filings (CGP, Tutela, Habeas Corpus)
    const { data: filings } = await supabase
      .from("filings")
      .select("id, filing_type, radicado, email_linking_enabled")
      .eq("owner_id", ownerId)
      .eq("email_linking_enabled", true)
      .not("radicado", "is", null);

    if (filings) {
      for (const filing of filings as FilingRecord[]) {
        const normalizedRadicado = (filing.radicado || "").replace(/[-\s]/g, "");
        if (radicados.includes(normalizedRadicado)) {
          let entityType: LinkCandidate["entity_type"] = "CGP_CASE";
          if (filing.filing_type === "TUTELA") entityType = "TUTELA";
          else if (filing.filing_type === "HABEAS_CORPUS") entityType = "HABEAS_CORPUS";

          candidates.push({
            entity_type: entityType,
            entity_id: filing.id,
            confidence: 0.95,
            reasons: [`Radicado "${filing.radicado}" encontrado en el mensaje`],
            auto_link: true,
          });
        }
      }
    }

    // Check monitored processes
    const { data: processes } = await supabase
      .from("monitored_processes")
      .select("id, radicado, email_linking_enabled")
      .eq("owner_id", ownerId)
      .eq("email_linking_enabled", true)
      .not("radicado", "is", null);

    if (processes) {
      for (const proc of processes as ProcessRecord[]) {
        const normalizedRadicado = (proc.radicado || "").replace(/[-\s]/g, "");
        if (radicados.includes(normalizedRadicado)) {
          candidates.push({
            entity_type: "PROCESO_ADMINISTRATIVO",
            entity_id: proc.id,
            confidence: 0.95,
            reasons: [`Radicado "${proc.radicado}" encontrado en el mensaje`],
            auto_link: true,
          });
        }
      }
    }
  }

  // 2) Match by client email
  const { data: clients } = await supabase
    .from("clients")
    .select("id, name, email, email_linking_enabled")
    .eq("owner_id", ownerId)
    .eq("email_linking_enabled", true)
    .not("email", "is", null);

  if (clients) {
    const allEmails = [message.from_email, ...message.to_emails, ...message.cc_emails]
      .map(e => e.toLowerCase());

    for (const client of clients as ClientRecord[]) {
      if (client.email && allEmails.includes(client.email.toLowerCase())) {
        candidates.push({
          entity_type: "CLIENT",
          entity_id: client.id,
          confidence: 0.9,
          reasons: [`Email del cliente "${client.name}" encontrado en el mensaje`],
          auto_link: true,
        });
      }
    }
  }

  // 3) Match by court email in filings
  const { data: filingsWithEmail } = await supabase
    .from("filings")
    .select("id, filing_type, court_email, court_name, email_linking_enabled")
    .eq("owner_id", ownerId)
    .eq("email_linking_enabled", true)
    .not("court_email", "is", null);

  if (filingsWithEmail) {
    for (const filing of filingsWithEmail as FilingRecord[]) {
      if (filing.court_email && message.from_email.toLowerCase() === filing.court_email.toLowerCase()) {
        let entityType: LinkCandidate["entity_type"] = "CGP_CASE";
        if (filing.filing_type === "TUTELA") entityType = "TUTELA";
        else if (filing.filing_type === "HABEAS_CORPUS") entityType = "HABEAS_CORPUS";

        // Check if already added by radicado
        const alreadyAdded = candidates.some(c => c.entity_id === filing.id);
        if (!alreadyAdded) {
          candidates.push({
            entity_type: entityType,
            entity_id: filing.id,
            confidence: 0.75,
            reasons: [`Email remitente coincide con juzgado "${filing.court_name}"`],
            auto_link: false, // Suggest only
          });
        }
      }
    }
  }

  return candidates;
}

// =============================================
// MAIN HANDLER
// =============================================

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const rawPayload = await req.text();
    const payloadHash = await hashPayload(rawPayload);
    
    let webhookData: ResendWebhookPayload;
    try {
      webhookData = JSON.parse(rawPayload);
    } catch {
      console.error("Invalid JSON payload");
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate it's an inbound email event
    if (webhookData.type !== "email.received" && webhookData.type !== "email.delivered") {
      // For non-inbound events, just acknowledge
      console.log(`Ignoring webhook event type: ${webhookData.type}`);
      return new Response(JSON.stringify({ status: "ignored", type: webhookData.type }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get owner from authorization header (API key lookup) or use default
    // For webhook, we need a way to identify the owner. 
    // Option: Use a query param or header with user identifier
    const url = new URL(req.url);
    const ownerIdParam = url.searchParams.get("owner_id");
    
    if (!ownerIdParam) {
      console.error("Missing owner_id parameter");
      return new Response(JSON.stringify({ error: "Missing owner_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for duplicate (idempotency)
    const { data: existing } = await supabase
      .from("inbound_messages")
      .select("id")
      .eq("owner_id", ownerIdParam)
      .eq("raw_payload_hash", payloadHash)
      .maybeSingle();

    if (existing) {
      console.log(`Duplicate message detected, hash: ${payloadHash}`);
      return new Response(JSON.stringify({ status: "duplicate", message_id: existing.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize the message
    const normalized = normalizeResendPayload(webhookData, payloadHash);

    // Insert the message
    const { data: message, error: insertError } = await supabase
      .from("inbound_messages")
      .insert({
        owner_id: ownerIdParam,
        source_provider: normalized.source_provider,
        source_message_id: normalized.source_message_id,
        from_name: normalized.from_name,
        from_email: normalized.from_email,
        to_emails: normalized.to_emails,
        cc_emails: normalized.cc_emails,
        subject: normalized.subject,
        date_header: normalized.date_header,
        text_body: normalized.text_body,
        html_body: normalized.html_body,
        body_preview: normalized.body_preview,
        thread_id: normalized.thread_id,
        references_header: normalized.references_header,
        in_reply_to: normalized.in_reply_to,
        raw_payload_hash: normalized.raw_payload_hash,
        processing_status: "NORMALIZED",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert message:", insertError);
      throw insertError;
    }

    console.log(`Message stored: ${message.id}`);

    // Store attachments (if any)
    if (normalized.attachments.length > 0) {
      const attachmentRecords = normalized.attachments.map(att => ({
        message_id: message.id,
        owner_id: ownerIdParam,
        filename: att.filename,
        mime_type: att.mime_type,
        size_bytes: att.size_bytes,
        is_inline: att.is_inline,
        // Note: In production, you'd upload content_base64 to storage
        // and store the path. For MVP, we skip content storage.
      }));

      const { error: attError } = await supabase
        .from("inbound_attachments")
        .insert(attachmentRecords);

      if (attError) {
        console.error("Failed to store attachments:", attError);
      }
    }

    // Run linking pipeline
    const candidates = await findLinkCandidates(supabase, ownerIdParam, normalized);
    
    if (candidates.length > 0) {
      const linkRecords = candidates.map(c => ({
        message_id: message.id,
        owner_id: ownerIdParam,
        entity_type: c.entity_type,
        entity_id: c.entity_id,
        link_status: c.auto_link ? "AUTO_LINKED" : "LINK_SUGGESTED",
        link_confidence: c.confidence,
        link_reasons: c.reasons,
        created_by: "SYSTEM",
      }));

      const { error: linkError } = await supabase
        .from("message_links")
        .insert(linkRecords);

      if (linkError) {
        console.error("Failed to create links:", linkError);
      } else {
        // Update message status
        await supabase
          .from("inbound_messages")
          .update({ processing_status: "LINKED" })
          .eq("id", message.id);
      }
    }

    console.log(`Processing complete. Links created: ${candidates.length}`);

    return new Response(
      JSON.stringify({ 
        status: "success", 
        message_id: message.id,
        links_created: candidates.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Inbound email error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
