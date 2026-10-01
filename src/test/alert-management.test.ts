/**
 * Alert management semantics: read / resolve / dismiss, durable closures,
 * shared cache reconciliation and the "Por tipo" list filter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

type Row = Record<string, unknown> & { id: string };
const db: { rows: Row[] } = { rows: [] };

function builder() {
  let op: "select" | "update" | "insert" = "select";
  let patch: Record<string, unknown> = {};
  const filters: Array<(r: Row) => boolean> = [];
  const exec = () => {
    const hit = db.rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") hit.forEach((r) => Object.assign(r, patch));
    return { data: hit.map((r) => ({ id: r.id, status: r.status })), error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Record<string, unknown>) => ((op = "update"), (patch = p), b),
    insert: (rows: Row[]) => {
      op = "insert";
      rows.forEach((r) => db.rows.push({ id: `new${db.rows.length}`, ...r }));
      return { select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) };
    },
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), b),
    in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), b),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), b),
    maybeSingle: async () => ({ data: exec().data[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve(exec()).then(res),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => builder() },
}));

import {
  markAlertsAsRead,
  resolveAlerts,
  dismissAlerts,
  createAlertIdempotent,
  decideReopen,
  removeAlertsFromCaches,
  markAlertsReadInCaches,
} from "@/lib/alerts";
import { filterBoardAlerts, type BoardAlert } from "@/components/alerts/AlertsByTypeTab";

const mk = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  status: "PENDING",
  severity: "CRITICAL",
  read_at: null,
  seen_at: null,
  ...extra,
});
const get = (id: string) => db.rows.find((r) => r.id === id)!;
const unreadBadge = () =>
  db.rows.filter((r) => r.status === "PENDING" && !r.read_at).length;

beforeEach(() => {
  db.rows = Array.from({ length: 14 }, (_, i) => mk(`a${i}`));
});

describe("single read semantic", () => {
  it("mark read sets read_at and seen_at, stays active, badge drops", async () => {
    const before = unreadBadge();
    await markAlertsAsRead(["a0"]);
    expect(get("a0").read_at).toBeTruthy();
    expect(get("a0").seen_at).toBeTruthy();
    expect(get("a0").status).toBe("PENDING");
    expect(unreadBadge()).toBe(before - 1);
  });
});

describe("closing alerts", () => {
  it("dismiss sets DISMISSED + dismissed_at + read/seen", async () => {
    await dismissAlerts(["a1"]);
    const r = get("a1");
    expect(r.status).toBe("DISMISSED");
    expect(r.dismissed_at && r.read_at && r.seen_at).toBeTruthy();
  });

  it("resolve sets RESOLVED + resolved_at and keeps the row", async () => {
    await resolveAlerts(["a2"]);
    const r = get("a2");
    expect(r.status).toBe("RESOLVED");
    expect(r.resolved_at && r.read_at && r.seen_at).toBeTruthy();
    expect(db.rows).toHaveLength(14);
  });

  it("keeps first read time on close", async () => {
    get("a3").read_at = "2026-01-01T00:00:00Z";
    await resolveAlerts(["a3"]);
    expect(get("a3").read_at).toBe("2026-01-01T00:00:00Z");
  });

  it("bulk of 3 touches exactly those 3", async () => {
    await resolveAlerts(["a4", "a5", "a6"]);
    expect(db.rows.filter((r) => r.status === "RESOLVED").map((r) => r.id)).toEqual(["a4", "a5", "a6"]);
    await dismissAlerts(["a7", "a8", "a9"]);
    expect(db.rows.filter((r) => r.status === "DISMISSED")).toHaveLength(3);
    await markAlertsAsRead(["a10", "a11", "a12"]);
    expect(db.rows.filter((r) => r.read_at && r.status === "PENDING")).toHaveLength(3);
  });

  it("group of 14 criticals: dismiss is idempotent", async () => {
    const ids = db.rows.map((r) => r.id);
    const first = await dismissAlerts(ids);
    const second = await dismissAlerts(ids);
    expect(first.count).toBe(14);
    expect(second.count).toBe(0);
    expect(unreadBadge()).toBe(0);
  });

  it("resolving a dismissed alert does not change its closure", async () => {
    await dismissAlerts(["a0"]);
    await resolveAlerts(["a0"]);
    expect(get("a0").status).toBe("DISMISSED");
  });
});

describe("durable closures", () => {
  it("policy: user closures stay closed, CANCELLED may reopen", () => {
    expect(decideReopen("DISMISSED", false)).toBe("keep_closed");
    expect(decideReopen("RESOLVED", false)).toBe("keep_closed");
    expect(decideReopen("RESOLVED", true)).toBe("reopen");
    expect(decideReopen("CANCELLED", false)).toBe("reopen");
    expect(decideReopen("PENDING", false)).toBe("noop");
  });

  it.each(["DISMISSED", "RESOLVED"])("same fingerprint after %s is not reopened", async (status) => {
    const params = {
      ownerId: "u1",
      entityType: "CPACA" as const,
      entityId: "w1",
      severity: "WARNING" as const,
      title: "t",
      message: "m",
      fingerprintKeys: { radicado: "r", eventType: "e", eventDate: "2026-10-01" },
    };
    await createAlertIdempotent(params);
    const created = db.rows.find((r) => r.owner_id === "u1")!;
    created.status = status;
    const res = await createAlertIdempotent(params);
    expect(res.closedByUser).toBe(true);
    expect(created.status).toBe(status);
    expect(db.rows.filter((r) => r.owner_id === "u1")).toHaveLength(1);
  });
});

describe("cache reconciliation", () => {
  it("removes closed rows from every list and marks read everywhere", () => {
    const qc = new QueryClient();
    const list = () => [{ id: "x" }, { id: "y", read_at: null }];
    qc.setQueryData(["alert_instances"], list());
    qc.setQueryData(["alerts-by-type"], list());
    qc.setQueryData(["alert-instances-notifications", "all", "all", false], list());
    removeAlertsFromCaches(qc, ["x"]);
    markAlertsReadInCaches(qc, ["y"]);
    for (const k of [["alert_instances"], ["alerts-by-type"], ["alert-instances-notifications", "all", "all", false]]) {
      const d = qc.getQueryData<Array<{ id: string; read_at?: string; seen_at?: string }>>(k)!;
      expect(d.map((r) => r.id)).toEqual(["y"]);
      expect(d[0].read_at && d[0].seen_at).toBeTruthy();
    }
  });
});

describe("Por tipo filters", () => {
  const rows = [
    { id: "1", status: "PENDING", severity: "CRITICAL", read_at: null },
    { id: "2", status: "PENDING", severity: "CRITICAL", read_at: "x" },
    { id: "3", status: "PENDING", severity: "INFO", read_at: null },
    { id: "4", status: "DISMISSED", severity: "CRITICAL", read_at: null },
    { id: "5", status: "RESOLVED", severity: "CRITICAL", read_at: null },
  ] as unknown as BoardAlert[];
  it("read alerts stay unless 'Solo sin leer'; closed never show", () => {
    expect(filterBoardAlerts(rows, { onlyActionable: true, onlyUnread: false }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterBoardAlerts(rows, { onlyActionable: true, onlyUnread: true }).map((r) => r.id)).toEqual(["1"]);
    expect(filterBoardAlerts(rows, { onlyActionable: false, onlyUnread: true }).map((r) => r.id)).toEqual(["1", "3"]);
  });
});
