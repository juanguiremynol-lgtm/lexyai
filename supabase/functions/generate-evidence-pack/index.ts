/**
 * generate-evidence-pack — Creates a downloadable Evidence Pack for a finalized document.
 * Returns a JSON manifest with all artifact URLs and hashes.
 * The actual ZIP assembly happens client-side to avoid large binary transfers from edge functions.
 *
 * Auth: requires JWT (authenticated user must own the document or be in the same org).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Recursive canonical JSON for hash verification */
function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  if (typeof obj === "object") {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return "{" + sorted.map(k => JSON.stringify(k) + ":" + canonicalStringify((obj as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Authorization required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Invalid auth" }, 401);

    const body = await req.json();
    const { document_id } = body;
    if (!document_id) return json({ error: "document_id required" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch document
    const { data: doc, error: docErr } = await adminClient
      .from("generated_documents")
      .select("id, organization_id, document_type, title, content_html, status, final_pdf_sha256, finalized_at, created_by, document_hash_presign, created_at")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) return json({ error: "Document not found" }, 404);

    // Auth check: user must be in same org
    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.organization_id !== doc.organization_id) {
      return json({ error: "Access denied" }, 403);
    }

    // Fetch signatures
    const { data: signatures } = await adminClient
      .from("document_signatures")
      .select("id, signer_name, signer_role, status, signed_at, signed_document_hash, combined_pdf_hash, certificate_path, signed_document_path, signing_order, identity_confirmed_at")
      .eq("document_id", document_id)
      .order("signing_order", { ascending: true });

    // Fetch all audit events (ordered chronologically)
    const { data: events } = await adminClient
      .from("document_signature_events")
      .select("id, event_type, event_data, actor_type, actor_id, created_at, event_hash, previous_event_hash, device_fingerprint_hash")
      .eq("document_id", document_id)
      .order("created_at", { ascending: true });

    // Fetch external proofs
    const { data: proofs } = await adminClient
      .from("document_evidence_proofs")
      .select("id, proof_type, label, file_name, file_sha256, mime_type, file_size_bytes, created_at, metadata")
      .eq("document_id", document_id)
      .order("created_at", { ascending: true });

    // Validate hash chain
    let chainValid = true;
    let chainErrors: string[] = [];
    if (events && events.length > 0) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (i === 0) {
          if (ev.previous_event_hash !== null) {
            chainValid = false;
            chainErrors.push(`Event ${i}: expected null previous_hash, got ${ev.previous_event_hash}`);
          }
        } else {
          if (ev.previous_event_hash !== events[i - 1].event_hash) {
            chainValid = false;
            chainErrors.push(`Event ${i}: previous_hash mismatch`);
          }
        }
      }
    }

    // Build events JSONL
    const eventsJsonl = (events || []).map(ev => JSON.stringify(ev)).join("\n");
    const eventsHash = await sha256Hex(eventsJsonl);

    // Build manifest
    const chainHeadHash = events && events.length > 0
      ? events[events.length - 1].event_hash
      : null;

    const manifest = {
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      document: {
        id: doc.id,
        type: doc.document_type,
        title: doc.title,
        status: doc.status,
        finalized_at: doc.finalized_at,
        final_pdf_sha256: doc.final_pdf_sha256,
        document_hash_presign: doc.document_hash_presign,
      },
      signatures: (signatures || []).map(s => ({
        id: s.id,
        signer_name: s.signer_name,
        role: s.signer_role,
        status: s.status,
        signed_at: s.signed_at,
        signed_document_hash: s.signed_document_hash,
        combined_pdf_hash: s.combined_pdf_hash,
        identity_confirmed: !!s.identity_confirmed_at,
      })),
      audit_chain: {
        total_events: events?.length || 0,
        chain_head_hash: chainHeadHash,
        chain_valid: chainValid,
        chain_errors: chainErrors.length > 0 ? chainErrors : undefined,
        events_jsonl_sha256: eventsHash,
      },
      external_proofs: (proofs || []).map(p => ({
        id: p.id,
        type: p.proof_type,
        label: p.label,
        file_name: p.file_name,
        file_sha256: p.file_sha256,
        uploaded_at: p.created_at,
      })),
      artifacts: {
        final_document_pdf: doc.final_pdf_sha256 ? { sha256: doc.final_pdf_sha256 } : null,
        raw_events_jsonl: { sha256: eventsHash, event_count: events?.length || 0 },
        manifest_json: "this_file",
      },
      legal_framework: {
        applicable_law: "Ley 527 de 1999 (Colombia)",
        decree: "Decreto 2364 de 2012",
        supplementary: "Decreto 806 de 2020",
      },
    };

    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestHash = await sha256Hex(manifestJson);

    // Build README
    const readme = `EVIDENCE PACK — ANDROMEDA LEGAL
================================

Document: ${doc.title}
Type: ${doc.document_type}
Document ID: ${doc.id}
Generated: ${new Date().toISOString()}

CONTENTS
--------
1. manifest.json        — Manifest with all file hashes and chain metadata
2. raw_events.jsonl     — Append-only audit event log (hash-chained)
3. README.txt           — This file

VERIFICATION INSTRUCTIONS
-------------------------
1. Go to the public verification page:
   ${supabaseUrl.replace('.supabase.co', '')}/verify

2. Upload the Evidence Pack ZIP file.

3. The system will:
   a. Parse manifest.json
   b. Verify each file's SHA-256 hash matches the manifest
   c. Replay the hash chain on raw_events.jsonl
   d. Report integrity status

MANUAL VERIFICATION (ADVANCED)
------------------------------
To verify manually:

  # 1. Verify final PDF hash
  sha256sum final_document.pdf
  # Compare with manifest.json → document.final_pdf_sha256

  # 2. Verify events JSONL hash
  sha256sum raw_events.jsonl
  # Compare with manifest.json → audit_chain.events_jsonl_sha256

  # 3. Verify hash chain
  # Each event's event_hash = SHA-256(previous_event_hash + canonical(event_data))
  # First event uses "GENESIS" as previous hash

LEGAL FRAMEWORK
---------------
- Ley 527 de 1999 (Comercio Electrónico, Colombia)
- Decreto 2364 de 2012 (Firma Electrónica)
- Decreto 806 de 2020 (Virtualidad Procesal)

This evidence pack constitutes a self-contained, tamper-evident record
of the document's lifecycle.

HASH CHAIN INTEGRITY
---------------------
Chain valid: ${chainValid ? "YES" : "NO — " + chainErrors.join("; ")}
Total events: ${events?.length || 0}
Chain head: ${chainHeadHash || "N/A"}

© Andromeda Legal — LEX ET LITTERAE S.A.S.
`;

    // Signed doc URLs (if they exist in storage)
    const signedDocUrls: Record<string, string> = {};
    if (signatures) {
      for (const sig of signatures) {
        if (sig.signed_document_path) {
          const { data: urlData } = await adminClient.storage
            .from("signed-documents")
            .createSignedUrl(sig.signed_document_path, 3600);
          if (urlData?.signedUrl) {
            signedDocUrls[sig.id] = urlData.signedUrl;
          }
        }
        if (sig.certificate_path) {
          const { data: certUrl } = await adminClient.storage
            .from("signed-documents")
            .createSignedUrl(sig.certificate_path, 3600);
          if (certUrl?.signedUrl) {
            signedDocUrls[`cert_${sig.id}`] = certUrl.signedUrl;
          }
        }
      }
    }

    // External proof download URLs
    const proofUrls: Record<string, string> = {};
    if (proofs) {
      for (const proof of proofs) {
        const { data: proofUrl } = await adminClient.storage
          .from("evidence-proofs")
          .createSignedUrl(proof.label, 3600); // label maps to path
        if (proofUrl?.signedUrl) {
          proofUrls[proof.id] = proofUrl.signedUrl;
        }
      }
    }

    return json({
      ok: true,
      manifest: manifest,
      manifest_json: manifestJson,
      manifest_sha256: manifestHash,
      events_jsonl: eventsJsonl,
      events_sha256: eventsHash,
      readme_txt: readme,
      download_urls: signedDocUrls,
      proof_urls: proofUrls,
    });
  } catch (err) {
    console.error("generate-evidence-pack error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
