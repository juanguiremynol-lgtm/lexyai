/**
 * Event Catalog Tests — Validates normalizers and catalog integrity
 */
import { describe, it, expect } from "vitest";
import {
  ANALYTICS_EVENTS,
  EVENT_PROPERTIES,
  toSizeBucket,
  toLatencyMs,
  toFileTypeCategory,
  toSafeRoute,
} from "@/lib/analytics/events";
import { DEFAULT_ALLOWED_PROPERTIES } from "@/lib/analytics/types";

describe("Event catalog integrity", () => {
  it("all event names are non-empty lowercase strings", () => {
    for (const [key, name] of Object.entries(ANALYTICS_EVENTS)) {
      expect(name).toBeTruthy();
      expect(name).toBe(name.toLowerCase());
    }
  });

  it("no duplicate event names", () => {
    const names = Object.values(ANALYTICS_EVENTS);
    expect(new Set(names).size).toBe(names.length);
  });

  it("EVENT_PROPERTIES keys reference valid event names", () => {
    const validNames = new Set(Object.values(ANALYTICS_EVENTS));
    for (const key of Object.keys(EVENT_PROPERTIES)) {
      expect(validNames.has(key as any)).toBe(true);
    }
  });

  it("all per-event properties exist in DEFAULT_ALLOWED_PROPERTIES", () => {
    for (const [event, props] of Object.entries(EVENT_PROPERTIES)) {
      for (const prop of props) {
        expect(DEFAULT_ALLOWED_PROPERTIES).toContain(prop);
      }
    }
  });
});

describe("toSizeBucket", () => {
  it("categorizes sizes correctly", () => {
    expect(toSizeBucket(50_000)).toBe("<100KB");
    expect(toSizeBucket(500_000)).toBe("100KB-1MB");
    expect(toSizeBucket(5_000_000)).toBe("1MB-10MB");
    expect(toSizeBucket(50_000_000)).toBe("10MB-100MB");
    expect(toSizeBucket(500_000_000)).toBe(">100MB");
  });
});

describe("toLatencyMs", () => {
  it("rounds and floors to zero", () => {
    expect(toLatencyMs(123.456)).toBe(123);
    expect(toLatencyMs(-5)).toBe(0);
    expect(toLatencyMs(0)).toBe(0);
  });
});

describe("toFileTypeCategory", () => {
  it("maps known extensions", () => {
    expect(toFileTypeCategory("report.pdf")).toBe("document");
    expect(toFileTypeCategory("data.xlsx")).toBe("spreadsheet");
    expect(toFileTypeCategory("photo.jpg")).toBe("image");
    expect(toFileTypeCategory("clip.mp4")).toBe("video");
  });

  it("returns 'other' for unknown extensions", () => {
    expect(toFileTypeCategory("file.xyz")).toBe("other");
    expect(toFileTypeCategory("noext")).toBe("other");
  });
});

describe("toSafeRoute", () => {
  it("strips query params and hash", () => {
    expect(toSafeRoute("/cases/123?search=test#section")).toBe("/cases/123");
    expect(toSafeRoute("/dashboard")).toBe("/dashboard");
  });

  it("handles full URLs", () => {
    expect(toSafeRoute("https://app.example.com/settings?tab=billing")).toBe("/settings");
  });
});
