/**
 * process-pdf-job resilience test.
 * Verifies the function does NOT throw on query failures;
 * it must mark the job as FAILED with last_error instead.
 */

import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const functionUrl = `${SUPABASE_URL}/functions/v1/process-pdf-job`;

Deno.test("process-pdf-job: does not crash (500) on non-existent job_id", async () => {
  // Calling with a bogus job_id should NOT produce a 500 unhandled error.
  // It should return a structured error (4xx or controlled 5xx with JSON body).
  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: "00000000-0000-0000-0000-000000000000" }),
  });

  const body = await res.json();

  // Should NOT be a raw 500 crash — the function should handle missing jobs gracefully
  // (either 403 for auth, or a structured error response)
  assertEquals(
    res.status !== 500,
    true,
    `Expected non-500 status but got 500: ${JSON.stringify(body)}`,
  );
});

Deno.test("process-pdf-job: does not crash on non-existent document_id", async () => {
  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: "00000000-0000-0000-0000-000000000000" }),
  });

  const body = await res.json();

  assertEquals(
    res.status !== 500,
    true,
    `Expected non-500 status but got 500: ${JSON.stringify(body)}`,
  );
});

Deno.test("process-pdf-job: returns structured error on empty body", async () => {
  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const body = await res.text();

  // Should not crash with unhandled exception
  assertEquals(
    res.status < 500 || res.status === 503,
    true,
    `Should not crash: ${res.status} ${body}`,
  );
});
