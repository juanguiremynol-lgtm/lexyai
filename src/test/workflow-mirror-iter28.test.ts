/**
 * Iteration 28 — workflow_type has a single source of truth.
 *
 * The denormalised mirrors on work_item_sync_timeline and sync_retry_queue
 * were dropped (option (a)); the mirrors that remain (work_item_acts,
 * gcp_lifecycle_outbox) are stamped/propagated by DB triggers, never by
 * callers. These tests guard the client/edge contract so no writer
 * re-introduces a second copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRACTICE_AREA_OPTIONS } from "@/hooks/use-practice-areas";
import { providerChainFor } from "@/lib/monitoring-matrix";
import { LABORAL_STAGES, getOrderedLaboralStages } from "@/lib/laboral-stages";

const read = (p: string) => readFileSync(p, "utf8");

describe("no writer mirrors workflow_type onto dropped columns", () => {
  it("syncTimeline shared helper does not write workflow_type", () => {
    const src = read("supabase/functions/_shared/syncTimeline.ts");
    expect(src).not.toMatch(/workflow_type/);
  });

  it("retry-queue writers do not write workflow_type", () => {
    const files = [
      "supabase/functions/_shared/whatsappTools.ts",
      "supabase/functions/fallback-sync-check/index.ts",
      "supabase/functions/sync-by-work-item/index.ts",
      "supabase/functions/sync-publicaciones-by-work-item/index.ts",
      "supabase/functions/scheduled-daily-sync/index.ts",
      "supabase/functions/atenia-ai-autopilot/index.ts",
    ];
    for (const f of files) {
      const src = read(f);
      // Every sync_retry_queue insert/upsert block must be free of workflow_type.
      const blocks = src.split(/sync_retry_queue["')\s]*\)?\s*(?:as any\s*\)?)?\s*\.\s*(?:insert|upsert)\(/).slice(1);
      for (const b of blocks) {
        expect(b.slice(0, 600)).not.toMatch(/workflow_type/);
      }
    }
  });

  it("the timeline UI no longer renders a mirrored workflow badge", () => {
    const src = read("src/components/work-items/SyncTimelineTab.tsx");
    expect(src).not.toMatch(/workflow_type/);
  });
});

describe("LABORAL board is supported without re-enabling inference", () => {
  it("LABORAL is a selectable practice area with a full stage set", () => {
    expect(PRACTICE_AREA_OPTIONS).toContain("LABORAL");
    expect(getOrderedLaboralStages()).toHaveLength(10);
    expect(LABORAL_STAGES.BORRADOR.order).toBe(1);
  });

  it("LABORAL keeps its provider chain (iteration 18 untouched)", () => {
    expect(providerChainFor("LABORAL")).toEqual(["cpnu", "publicaciones"]);
  });
});
