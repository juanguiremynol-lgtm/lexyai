/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
  deadlineEventKey,
  groupDeadlineEvents,
  visibleDeadlineRows,
  type PendingDeadlineRow,
} from "@/lib/pending-review";
import { nextMorningCOT } from "@/lib/deadline-review-state";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const summaryMock = vi.hoisted(() => ({ usePendingReviewSummary: vi.fn() }));
const dailyMock = vi.hoisted(() => ({ useLexyDailyMessage: vi.fn() }));
vi.mock("@/hooks/use-pending-review-summary", () => summaryMock);
vi.mock("@/hooks/useLexyDailyMessage", () => dailyMock);

import { updateDeadlineReviewState } from "@/lib/deadline-review-state";
import { LexyPendingReviewDialog } from "@/components/lexy/LexyPendingReviewDialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const row = (id: string, wi = "wi-1", type = "RESPUESTA_REQUERIMIENTO", label = "AUTO_REQUERIMIENTO"): PendingDeadlineRow => ({
  id,
  work_item_id: wi,
  label,
  deadline_type: type,
  trigger_date: null,
  work_items: { id: wi, radicado: "05001310302120250021100", title: null },
});

describe("pending review backlog grouping and per-user visibility", () => {
  it("duplicate rows of the same event collapse into one notice without losing ids", () => {
    const rows = Array.from({ length: 13 }, (_, i) => row(`d${i}`));
    const events = groupDeadlineEvents(rows);
    expect(events).toHaveLength(1);
    expect(events[0].ids).toHaveLength(13);
    expect(events[0].radicado).toBe("05001310302120250021100");
  });

  it("distinct events on the same matter stay separate", () => {
    const events = groupDeadlineEvents([
      row("a", "wi-1", "RESPUESTA_REQUERIMIENTO", "AUTO_REQUERIMIENTO"),
      row("b", "wi-1", "REVISION_MANUAL", "RECONOCIMIENTO_NOTIFICACION"),
      row("c", "wi-2", "RESPUESTA_REQUERIMIENTO", "AUTO_REQUERIMIENTO"),
    ]);
    expect(events).toHaveLength(3);
  });

  it("acknowledged and future-snoozed rows are hidden; expired snooze and new rows stay visible", () => {
    const now = new Date("2026-10-21T12:00:00Z");
    const rows = [row("ack"), row("snoozed"), row("expired"), row("new")];
    const visible = visibleDeadlineRows(rows, [
      { deadline_id: "ack", acknowledged_at: "2026-10-21T10:00:00Z", snoozed_until: null },
      { deadline_id: "snoozed", acknowledged_at: null, snoozed_until: "2026-10-22T12:00:00Z" },
      { deadline_id: "expired", acknowledged_at: null, snoozed_until: "2026-10-21T06:00:00Z" },
    ], now);
    expect(visible.map((r) => r.id)).toEqual(["expired", "new"]);
  });

  it("event identity never includes the row id, so a resynced identical row groups together", () => {
    expect(deadlineEventKey(row("x"))).toBe(deadlineEventKey(row("y")));
  });
});

describe("deadline review state writes", () => {
  beforeEach(() => rpc.mockReset());

  it("acknowledges every requested row in one call", async () => {
    rpc.mockResolvedValue({ data: [{ deadline_id: "a" }, { deadline_id: "b" }], error: null });
    await updateDeadlineReviewState(["a", "b"], "acknowledge");
    expect(rpc).toHaveBeenCalledWith("acknowledge_deadline_reviews", { _ids: ["a", "b"], _action: "acknowledge", _until: null });
  });

  it("rejects partial confirmation rather than silently succeeding", async () => {
    rpc.mockResolvedValue({ data: [{ deadline_id: "a" }], error: null });
    await expect(updateDeadlineReviewState(["a", "b"], "acknowledge")).rejects.toThrow();
  });

  it("propagates write failures so the UI can roll back", async () => {
    rpc.mockResolvedValue({ error: new Error("denied"), data: null });
    await expect(updateDeadlineReviewState(["a"], "snooze", "2026-10-22T12:00:00Z")).rejects.toThrow("denied");
  });

  it("snoozes until the next Bogotá morning", () => {
    const until = new Date(nextMorningCOT(new Date("2026-10-21T20:00:00Z")));
    expect(until.toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });
});

describe("LexyPendingReviewDialog", () => {
  const summary = (over: Partial<ReturnType<typeof summaryMock.usePendingReviewSummary>["data"] & object> = {}) =>
    summaryMock.usePendingReviewSummary.mockReturnValue({
      data: {
        suggestedLinks: 0,
        manualDeadlines: 2,
        events: [
          { key: "k1", work_item_id: "wi-1", radicado: "05001310302120250021100", title: null, label: "AUTO_REQUERIMIENTO", deadline_type: "RESPUESTA_REQUERIMIENTO", ids: ["a", "b"] },
        ],
        ids: ["a", "b"],
        deadlines: [],
        total: 1,
        ...over,
      },
    });

  const renderDialog = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LexyPendingReviewDialog />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    cleanup();
    rpc.mockReset();
    summaryMock.usePendingReviewSummary.mockReset();
    dailyMock.useLexyDailyMessage.mockReset();
  });

  it("stays closed while the daily Lexy greeting is unseen", () => {
    summary();
    dailyMock.useLexyDailyMessage.mockReturnValue({ isNew: true });
    renderDialog();
    expect(screen.queryByText(/tienes pendientes que requieren tu revisión/)).toBeNull();
  });

  it("acknowledging marks every row id and closes", async () => {
    rpc.mockResolvedValue({ data: [{ deadline_id: "a" }, { deadline_id: "b" }], error: null });
    summary();
    dailyMock.useLexyDailyMessage.mockReturnValue({ isNew: false });
    renderDialog();
    const btn = await screen.findByRole("button", { name: "Ya tengo conocimiento" });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("acknowledge_deadline_reviews", { _ids: ["a", "b"], _action: "acknowledge", _until: null }),
    );
  });

  it("a failed write reopens the dialog (rollback)", async () => {
    rpc.mockResolvedValue({ error: new Error("denied"), data: null });
    summary();
    dailyMock.useLexyDailyMessage.mockReturnValue({ isNew: false });
    renderDialog();
    const btn = await screen.findByRole("button", { name: "Ya tengo conocimiento" });
    fireEvent.click(btn);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(await screen.findByText(/tienes pendientes que requieren tu revisión/)).toBeTruthy();
  });

  it("snooze persists until the next morning instead of localStorage", async () => {
    rpc.mockResolvedValue({ data: [{ deadline_id: "a" }, { deadline_id: "b" }], error: null });
    summary();
    dailyMock.useLexyDailyMessage.mockReturnValue({ isNew: false });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Aplazar" }));
    await waitFor(() => {
      const call = rpc.mock.calls.find((c) => c[1]?._action === "snooze");
      expect(call).toBeTruthy();
      expect(new Date(call[1]._until).getTime()).toBeGreaterThan(Date.now());
    });
  });
});
