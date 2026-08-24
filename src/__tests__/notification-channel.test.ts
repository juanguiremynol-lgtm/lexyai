/**
 * D1 — one fact, one channel.
 *
 * These tests pin the rule that produced four emails on 24/08/2026 where
 * there should have been one: the consolidated digest is the default, and the
 * per-event sender only fires when the recipient (or the matter) asked for it.
 */
import { describe, expect, it } from "vitest";
import {
  immediateAllowed,
  resolveChannelPolicy,
} from "../../supabase/functions/_shared/notificationChannel.ts";

describe("resolveChannelPolicy", () => {
  it("defaults to the consolidated digest when nothing is configured", () => {
    expect(resolveChannelPolicy(null)).toEqual({ channelDefault: "DIGEST", immediateEvents: [] });
    expect(resolveChannelPolicy({})).toEqual({ channelDefault: "DIGEST", immediateEvents: [] });
  });

  it("honours an explicit IMMEDIATE default", () => {
    expect(resolveChannelPolicy({ channel_default: "immediate" }).channelDefault).toBe("IMMEDIATE");
  });

  it("keeps only known immediate event keys", () => {
    const p = resolveChannelPolicy({ immediate_events: ["HEARING_SCHEDULED", "NOPE"] });
    expect(p.immediateEvents).toEqual(["HEARING_SCHEDULED"]);
  });
});

describe("immediateAllowed", () => {
  const digestOnly = resolveChannelPolicy(null);

  it("blocks per-event mail under the default policy", () => {
    expect(immediateAllowed(digestOnly, null, null)).toBe(false);
  });

  it("allows an explicitly opted-in event", () => {
    const p = resolveChannelPolicy({ immediate_events: ["TERM_EXPIRING"] });
    expect(immediateAllowed(p, null, "TERM_EXPIRING")).toBe(true);
    expect(immediateAllowed(p, null, "HEARING_SCHEDULED")).toBe(false);
  });

  it("lets a matter override the user preference in both directions", () => {
    expect(immediateAllowed(digestOnly, "IMMEDIATE", null)).toBe(true);
    const always = resolveChannelPolicy({ channel_default: "IMMEDIATE" });
    expect(immediateAllowed(always, "DIGEST_ONLY", "TERM_EXPIRING")).toBe(false);
  });
});
