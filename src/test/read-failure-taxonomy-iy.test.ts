import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const digest = read("supabase/functions/scheduled-daily-digest/index.ts");
const poller = read("supabase/functions/cpnu-job-poller/index.ts");
const chain = read("supabase/functions/_shared/resolveProviderChain.ts");

describe("IY — read evidence and failure taxonomy", () => {
  it("uses manual findings without writing them into derived court profiles", () => {
    expect(digest).toMatch(/from\("manual_court_findings"\)/);
    expect(digest).not.toMatch(/from\("despacho_profiles"\).*manual_court_findings/s);
  });

  it("treats a successful empty provider answer as a read, not a failure", () => {
    expect(digest).toMatch(/runStatus === "SUCCESS"/);
    expect(digest).toMatch(/runCode === "PROVIDER_EMPTY_RESULT"/);
  });

  it("records a reason when invoking the sync function fails", () => {
    expect(poller).toMatch(/last_error_code: 'SYNC_INVOKE_FAILED'/);
  });

  it("does not retain UNKNOWN_ERROR in provider fallback taxonomy", () => {
    expect(chain).not.toMatch(/["']UNKNOWN_ERROR["']/);
    expect(chain).toMatch(/UNCLASSIFIED_PROVIDER_SHAPE/);
  });
});