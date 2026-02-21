/**
 * bulk-export-documents — Generates a full ZIP export of all org documents,
 * evidence packs, external proofs, and metadata for archival or pre-deactivation.
 *
 * Returns a JSON manifest with signed download URLs for each artifact.
 * The client assembles the ZIP.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    // Get all non-deleted documents for the org
    const { data: docs, error: docsErr } = await adminClient
      .from("generated_documents")
      .select("id, title, document_type, status, finalized_at, retention_expires_at, retention_years, work_item_id, created_at, storage_path")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (docsErr) throw new Error(docsErr.message);

    const allDocs = docs ?? [];

    // Generate signed URLs for each document's PDF
    const downloadUrls: Record<string, string> = {};
    for (const doc of allDocs) {
      if (doc.storage_path) {
        const { data: signed } = await adminClient.storage
          .from("generated-documents")
          .createSignedUrl(doc.storage_path, 3600); // 1 hour
        if (signed?.signedUrl) {
          downloadUrls[doc.id] = signed.signedUrl;
        }
      }
    }

    // Get all external proofs
    const docIds = allDocs.map((d) => d.id);
    let proofs: any[] = [];
    const proofUrls: Record<string, string> = {};
    if (docIds.length > 0) {
      const { data: proofData } = await adminClient
        .from("document_evidence_proofs")
        .select("id, document_id, file_name, proof_type, sha256_hash, storage_path, created_at")
        .in("document_id", docIds);
      proofs = proofData ?? [];

      // Sign proof URLs
      for (const proof of proofs) {
        if (proof.storage_path) {
          const { data: signed } = await adminClient.storage
            .from("evidence-proofs")
            .createSignedUrl(proof.storage_path, 3600);
          if (signed?.signedUrl) {
            proofUrls[proof.id] = signed.signedUrl;
          }
        }
      }
    }

    // Get retention policies for the org
    const { data: retentionPolicies } = await adminClient
      .from("document_retention_policies")
      .select("document_type, retention_years")
      .eq("organization_id", orgId);

    // Build export manifest
    const manifest = {
      export_type: "BULK_ARCHIVE",
      generated_at: new Date().toISOString(),
      organization_id: orgId,
      total_documents: allDocs.length,
      finalized_documents: allDocs.filter((d) => d.finalized_at).length,
      total_external_proofs: proofs.length,
      retention_policies: retentionPolicies ?? [],
      documents: allDocs.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.document_type,
        status: d.status,
        finalized_at: d.finalized_at,
        retention_expires_at: d.retention_expires_at,
        retention_years: d.retention_years,
        work_item_id: d.work_item_id,
        created_at: d.created_at,
        has_pdf: !!downloadUrls[d.id],
      })),
      external_proofs: proofs.map((p) => ({
        id: p.id,
        document_id: p.document_id,
        file_name: p.file_name,
        proof_type: p.proof_type,
        sha256_hash: p.sha256_hash,
        created_at: p.created_at,
      })),
    };

    return new Response(
      JSON.stringify({
        ok: true,
        manifest,
        download_urls: downloadUrls,
        proof_urls: proofUrls,
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
