import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  hearingNotificationArgs, taskNotificationArgs, taskOwnerNotificationArgs, buildEmailStats,
} from "../../supabase/functions/scheduled-alert-evaluator/payloads.ts";

const task = { id: "t1", owner_id: "o1", assigned_to: "a1", title: "X", due_date: "2026-11-20", work_item_id: "w1", priority: "ALTA" };
const hearing = { id: "h1", title: "Inicial", location: null, is_virtual: true, scheduled_at: "2026-11-27T15:00:00Z", work_item_id: "w1" };

function assertPlainObject(m: unknown) {
  expect(typeof m).toBe("object");
  expect(m).not.toBeNull();
  expect(Array.isArray(m)).toBe(false);
  // No double encoding: no value is a serialized JSON string
  for (const v of Object.values(m as object)) {
    if (typeof v === "string") expect(v.trim().startsWith("{")).toBe(false);
  }
}

describe("scheduled-alert-evaluator insert_notification args", () => {
  it("hearing branch sends metadata as object", () => {
    const a = hearingNotificationArgs(hearing, "u1", "24h", 20, "2026-11-26-12");
    assertPlainObject(a.p_metadata);
    expect(a.p_metadata).toEqual({ hearing_id: "h1", scheduled_at: hearing.scheduled_at, hours_until: 20, bracket: "24h" });
    expect(a.p_dedupe_key).toBe("hearing_reminder:h1:24h:2026-11-26-12");
    expect(a.p_user_id).toBe("u1");
  });
  it("task branch targets assignee with object metadata", () => {
    const a = taskNotificationArgs(task, 5, "2026-11-25");
    assertPlainObject(a.p_metadata);
    expect(a.p_user_id).toBe("a1");
    expect(a.p_dedupe_key).toBe("task_overdue:t1:2026-11-25");
    expect(a.p_severity).toBe("critical");
  });
  it("owner copy keeps same dedupe key and object metadata", () => {
    const a = taskOwnerNotificationArgs(task, 1, "2026-11-25");
    assertPlainObject(a.p_metadata);
    expect(a.p_user_id).toBe("o1");
    expect(a.p_dedupe_key).toBe("task_overdue:t1:2026-11-25");
  });
  it("stats never claim emails or inserted alerts", () => {
    const s = buildEmailStats({ evaluated: 45, accepted: 0, failed: 45 });
    expect(s.emails_failed).toBe(0);
    expect(s.emails_sent).toBe(0);
    expect(s.notification_requests_failed).toBe(45);
    expect(s.notification_requests_accepted).toBe(0);
  });
  it("evaluator source no longer stringifies metadata", () => {
    const src = readFileSync("supabase/functions/scheduled-alert-evaluator/index.ts", "utf8");
    expect(src).not.toMatch(/p_metadata:\s*JSON\.stringify/);
    expect((src.match(/rpc\(\s*"insert_notification"/g) || []).length).toBe(3);
  });
});
