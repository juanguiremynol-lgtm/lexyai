/**
 * Regression guard: Limits Source of Truth
 *
 * Static code checks ensuring:
 * 1. No enforcement function/migration reads billing_plans for limits
 * 2. The ACTION_ALLOWLIST contains no sync actions
 * 3. The capability map references PARTIAL_ADMIN_VIEW
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(path.resolve(filePath), "utf-8");
  } catch {
    return "";
  }
}

describe("Limits source of truth regression guard", () => {
  it("enforce_membership_cap migration delegates to get_effective_limits", () => {
    // Scan all migration files for the latest enforce_membership_cap definition
    const migrationsDir = path.resolve("supabase/migrations");
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    
    let latestBody = "";
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      if (content.includes("enforce_membership_cap")) {
        latestBody = content;
      }
    }

    expect(latestBody).toBeTruthy();
    // Must reference get_effective_limits
    expect(latestBody).toContain("get_effective_limits");
    // Must NOT directly query billing_plans for max_members
    // (the migration file may mention billing_plans for UPDATE alignment, 
    //  but the function body itself must not SELECT FROM billing_plans)
    const fnMatch = latestBody.match(/CREATE OR REPLACE FUNCTION public\.enforce_membership_cap\(\)[\s\S]*?\$\$/);
    if (fnMatch) {
      const fnBody = fnMatch[0];
      expect(fnBody).not.toMatch(/FROM\s+billing_plans/i);
      expect(fnBody).not.toMatch(/SELECT.*bp\.max_members.*FROM.*billing_plans/i);
    }
  });

  it("no sync actions in ACTION_ALLOWLIST", () => {
    const source = readFile("supabase/functions/atenia-assistant/index.ts");
    expect(source).toBeTruthy();

    const forbidden = [
      "RUN_SYNC_WORK_ITEM",
      "RUN_SYNC_PUBLICACIONES_WORK_ITEM",
      "RUN_MASTER_SYNC_SCOPE",
    ];

    // Extract the ACTION_ALLOWLIST block
    const allowlistMatch = source.match(/ACTION_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(allowlistMatch).toBeTruthy();
    const allowlistBlock = allowlistMatch![1];

    for (const action of forbidden) {
      expect(allowlistBlock).not.toContain(action);
    }
  });

  it("system prompt includes capability map with PARTIAL_ADMIN_VIEW", () => {
    const source = readFile("supabase/functions/atenia-assistant/index.ts");
    expect(source).toContain("CAPABILITY MAP");
    expect(source).toContain("PARTIAL_ADMIN_VIEW");
    expect(source).toContain("RUN_DIAGNOSTIC_PLAYBOOK");
  });

  it("system prompt never suggests sync/retry in recommended actions", () => {
    const source = readFile("supabase/functions/atenia-assistant/index.ts");
    
    // The SYSTEM_PROMPT should explicitly forbid these
    expect(source).toContain("NEVER suggest manually triggering a sync");
    expect(source).toContain("NEVER propose sync/retry/refresh actions");
  });

  it("billing_plans alignment values match in migration", () => {
    // Verify the alignment migration exists
    const migrationsDir = path.resolve("supabase/migrations");
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    
    let hasAlignment = false;
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      if (
        content.includes("UPDATE public.billing_plans SET max_members = 5 WHERE code = 'BASIC'") &&
        content.includes("UPDATE public.billing_plans SET max_members = 20 WHERE code = 'PRO'") &&
        content.includes("UPDATE public.billing_plans SET max_members = 100 WHERE code = 'ENTERPRISE'")
      ) {
        hasAlignment = true;
      }
    }
    expect(hasAlignment).toBe(true);
  });
});
