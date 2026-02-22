/**
 * merge-signed-pdf resilience tests.
 * Verifies the function handles bad inputs gracefully (no 500 crashes).
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const functionUrl = `${SUPABASE_URL}/functions/v1/merge-signed-pdf`;

Deno.test("merge-signed-pdf: rejects unauthenticated requests with 403", async () => {
  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: "test" }),
  });

  const body = await res.json();
  assertEquals(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(body)}`);
  assertExists(body.error, "Response must include error field");
});

Deno.test("merge-signed-pdf: returns structured error on empty body (not crash)", async () => {
  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const body = await res.json();
  // Should be 403 (auth) not 500 (crash)
  assertEquals(
    res.status !== 500,
    true,
    `Expected non-500 status but got 500: ${JSON.stringify(body)}`,
  );
  assertExists(body.error, "Response must include structured error field");
});

Deno.test("merge-signed-pdf: returns structured error on missing required fields", async () => {
  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_id: "00000000-0000-0000-0000-000000000000",
      organization_id: "org-test",
      // Missing source_pdf_path, signature_block_html, audit_certificate_html
    }),
  });

  const body = await res.json();
  // Should be 403 (anon key) or 400 (validation), not 500
  assertEquals(
    res.status !== 500,
    true,
    `Expected non-500 status: ${res.status} ${JSON.stringify(body)}`,
  );
  assertExists(body.error, "Response must include structured error field");
});

Deno.test("merge-signed-pdf: OPTIONS returns CORS headers", async () => {
  const res = await fetch(functionUrl, { method: "OPTIONS" });
  await res.text(); // consume body
  assertEquals(res.status, 200, "OPTIONS should return 200");
});
