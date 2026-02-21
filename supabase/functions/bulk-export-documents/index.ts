/**
 * bulk-export-documents — Generates a court-ready export manifest with
 * per-document hashes, chain validation status, and signed download URLs.
 *
 * AUTHORIZATION: Org admins only (OWNER/ADMIN role + bulk_export_enabled flag).
 * AUDIT: Creates immutable export_audit_events (REQUESTED, READY).
 * SECURITY: Returns signed URLs only to authorized admins.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Get user's org
    const { data: profile } = await userClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    const orgId = profile?.organization_id;
    if (!orgId) {
      return new Response(
        JSON.stringify({ error: "No organization found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // AUTHORIZATION: Must be org admin (OWNER/ADMIN)
    const { data: membership } = await adminClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return new Response(
        JSON.stringify({ error: "Solo administradores pueden ejecutar exportaciones masivas" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // FEATURE FLAG: Must be enabled
    const { data: org } = await adminClient
      .from("organizations")
      .select("bulk_export_enabled, bulk_export_scope")
      .eq("id", orgId)
      .maybeSingle();

    if (!org?.bulk_export_enabled) {
      return new Response(
        JSON.stringify({ error: "La exportación masiva no está habilitada para esta organización" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const exportScope = org.bulk_export_scope || "finalized_only";

    // Parse optional body for date range
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    try {
      const body = await req.json();
      dateFrom = body?.date_from || null;
      dateTo = body?.date_to || null;
    } catch { /* no body is fine */ }

    // AUDIT: Log REQUESTED event
    const requestedEventData = JSON.stringify({
      org_id: orgId,
      scope: exportScope,
      date_from: dateFrom,
      date_to: dateTo,
      actor: user.id,
    });
    const requestedHash = await sha256Hex(requestedEventData);

    await adminClient.from("export_audit_events").insert({
      organization_id: orgId,
      actor_user_id: user.id,
      event_type: "BULK_EXPORT_REQUESTED",
      metadata: { scope: exportScope, date_from: dateFrom, date_to: dateTo },
      event_hash: requestedHash,
      previous_event_hash: null,
    });

    // Build query based on export scope
    let query = adminClient
      .from("generated_documents")
      .select("id, title, document_type, status, finalized_at, retention_expires_at, retention_years, work_item_id, created_at, storage_path, final_pdf_sha256, legal_hold")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (exportScope === "finalized_only") {
      query = query.not("finalized_at", "is", null);
    }
    if (dateFrom) {
      query = query.gte("created_at", dateFrom);
    }
    if (dateTo) {
      query = query.lte("created_at", dateTo);
    }

    const { data: docs, error: docsErr } = await query;
    if (docsErr) throw new Error(docsErr.message);
    const allDocs = docs ?? [];

    // Generate signed URLs for each document's PDF
    const downloadUrls: Record<string, string> = {};
    for (const doc of allDocs) {
      if (doc.storage_path) {
        const { data: signed } = await adminClient.storage
          .from("generated-documents")
          .createSignedUrl(doc.storage_path, 3600);
        if (signed?.signedUrl) {
          downloadUrls[doc.id] = signed.signedUrl;
        }
      }
    }

    // Get all external proofs with server hashes
    const docIds = allDocs.map((d) => d.id);
    let proofs: any[] = [];
    const proofUrls: Record<string, string> = {};
    if (docIds.length > 0) {
      // Batch in chunks of 100 to avoid query limits
      for (let i = 0; i < docIds.length; i += 100) {
        const chunk = docIds.slice(i, i + 100);
        const { data: proofData } = await adminClient
          .from("document_evidence_proofs")
          .select("id, document_id, file_name, proof_type, file_sha256, server_sha256, storage_path, label, created_at")
          .in("document_id", chunk);
        if (proofData) proofs.push(...proofData);
      }

      // Sign proof URLs
      for (const proof of proofs) {
        if (proof.storage_path || proof.label) {
          const path = proof.storage_path || proof.label;
          const { data: signed } = await adminClient.storage
            .from("evidence-proofs")
            .createSignedUrl(path, 3600);
          if (signed?.signedUrl) {
            proofUrls[proof.id] = signed.signedUrl;
          }
        }
      }
    }

    // Per-document chain validation
    const perDocChainStatus: Record<string, { valid: boolean; event_count: number; head_hash: string | null }> = {};
    for (const doc of allDocs) {
      if (doc.finalized_at) {
        const { data: events } = await adminClient
          .from("document_signature_events")
          .select("event_hash, previous_event_hash")
          .eq("document_id", doc.id)
          .order("created_at", { ascending: true });

        let valid = true;
        if (events && events.length > 0) {
          for (let i = 0; i < events.length; i++) {
            if (i === 0) {
              if (events[i].previous_event_hash !== null) valid = false;
            } else {
              if (events[i].previous_event_hash !== events[i - 1].event_hash) valid = false;
            }
          }
        }
        perDocChainStatus[doc.id] = {
          valid,
          event_count: events?.length ?? 0,
          head_hash: events && events.length > 0 ? events[events.length - 1].event_hash : null,
        };
      }
    }

    // Get retention policies
    const { data: retentionPolicies } = await adminClient
      .from("document_retention_policies")
      .select("document_type, retention_years")
      .eq("organization_id", orgId);

    // Build court-ready manifest
    const manifest = {
      schema_version: "2.0",
      export_type: "BULK_ARCHIVE",
      generated_at: new Date().toISOString(),
      organization_id: orgId,
      export_scope: exportScope,
      date_range: dateFrom || dateTo ? { from: dateFrom, to: dateTo } : null,
      total_documents: allDocs.length,
      finalized_documents: allDocs.filter((d) => d.finalized_at).length,
      total_external_proofs: proofs.length,
      retention_policies: retentionPolicies ?? [],
      documents: allDocs.map((d) => {
        const chain = perDocChainStatus[d.id];
        const docProofs = proofs.filter((p) => p.document_id === d.id);
        return {
          id: d.id,
          title: d.title,
          type: d.document_type,
          status: d.status,
          finalized_at: d.finalized_at,
          retention_expires_at: d.retention_expires_at,
          retention_years: d.retention_years,
          legal_hold: d.legal_hold,
          work_item_id: d.work_item_id,
          created_at: d.created_at,
          has_pdf: !!downloadUrls[d.id],
          final_pdf_sha256: d.final_pdf_sha256 || null,
          chain_validated: chain?.valid ?? null,
          chain_event_count: chain?.event_count ?? 0,
          chain_head_hash: chain?.head_hash ?? null,
          external_proofs: docProofs.map((p) => ({
            id: p.id,
            file_name: p.file_name,
            proof_type: p.proof_type,
            client_sha256: p.file_sha256,
            server_sha256: p.server_sha256,
            hash_match: p.server_sha256 ? p.file_sha256 === p.server_sha256 : null,
          })),
        };
      }),
      verification: {
        instructions: "Each file's SHA-256 hash can be verified against the manifest. Chain validation replays the event hash chain per document.",
        legal_framework: {
          applicable_law: "Ley 527 de 1999 (Colombia)",
          decree: "Decreto 2364 de 2012",
          supplementary: "Decreto 806 de 2020",
        },
      },
    };

    // Compute manifest hash for READY event
    const manifestJson = JSON.stringify(manifest);
    const manifestHash = await sha256Hex(manifestJson);

    // AUDIT: Log READY event (chained to REQUESTED)
    const readyHash = await sha256Hex(requestedHash + manifestHash);
    await adminClient.from("export_audit_events").insert({
      organization_id: orgId,
      actor_user_id: user.id,
      event_type: "BULK_EXPORT_READY",
      metadata: {
        manifest_sha256: manifestHash,
        file_count: allDocs.length + proofs.length,
        total_documents: allDocs.length,
        total_proofs: proofs.length,
      },
      event_hash: readyHash,
      previous_event_hash: requestedHash,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        manifest,
        manifest_sha256: manifestHash,
        download_urls: downloadUrls,
        proof_urls: proofUrls,
        audit: {
          requested_hash: requestedHash,
          ready_hash: readyHash,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("bulk-export-documents error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
