/**
 * cpnuFreshnessGate_test.ts — Tests for snapshot staleness detection.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkSnapshotFreshness,
  extractMaxActDate,
  buildIngestionMetadata,
} from "./cpnuFreshnessGate.ts";

Deno.test("checkSnapshotFreshness: forceRefresh always returns stale", () => {
  const result = checkSnapshotFreshness({
    snapshotMaxActDate: "2026-02-24",
    dbMaxActDate: "2026-02-20",
    snapshotRecordCount: 50,
    forceRefresh: true,
  });
  assertEquals(result.isStale, true);
  assertEquals(result.reason, "FORCE_REFRESH");
});

Deno.test("checkSnapshotFreshness: no snapshot dates → stale", () => {
  const result = checkSnapshotFreshness({
    snapshotMaxActDate: null,
    dbMaxActDate: "2026-02-20",
    snapshotRecordCount: 0,
  });
  assertEquals(result.isStale, true);
  assertEquals(result.reason, "NO_SNAPSHOT_DATES");
});

Deno.test("checkSnapshotFreshness: snapshot max date too old → stale", () => {
  const result = checkSnapshotFreshness({
    snapshotMaxActDate: "2025-06-15", // Very old
    dbMaxActDate: null,
    snapshotRecordCount: 30,
  });
  assertEquals(result.isStale, true);
  assertEquals(result.reason, "SNAPSHOT_MAX_DATE_TOO_OLD");
});

Deno.test("checkSnapshotFreshness: snapshot behind DB → stale", () => {
  // Use recent dates so SNAPSHOT_MAX_DATE_TOO_OLD doesn't fire first
  const today = new Date();
  const twoDaysAgo = new Date(today.getTime() - 2 * 86400000).toISOString().slice(0, 10);
  const oneDayAgo = new Date(today.getTime() - 1 * 86400000).toISOString().slice(0, 10);

  const result = checkSnapshotFreshness({
    snapshotMaxActDate: twoDaysAgo,
    dbMaxActDate: oneDayAgo,
    snapshotRecordCount: 50,
  });
  assertEquals(result.isStale, true);
  assertEquals(result.reason, "SNAPSHOT_BEHIND_DB");
});

Deno.test("checkSnapshotFreshness: low record count → stale", () => {
  const result = checkSnapshotFreshness({
    snapshotMaxActDate: "2026-02-24",
    dbMaxActDate: "2026-02-20",
    snapshotRecordCount: 3,
    historicalRecordCount: 50,
  });
  assertEquals(result.isStale, true);
  assertEquals(result.reason, "RECORD_COUNT_LOW");
});

Deno.test("checkSnapshotFreshness: fresh snapshot → not stale", () => {
  // Use a date that's "today" relative to check — since we can't mock getCOTToday,
  // use a date within 7 days of when this test runs
  const today = new Date();
  const recent = new Date(today.getTime() - 2 * 86400000); // 2 days ago
  const recentStr = recent.toISOString().slice(0, 10);

  const result = checkSnapshotFreshness({
    snapshotMaxActDate: recentStr,
    dbMaxActDate: null,
    snapshotRecordCount: 30,
  });
  assertEquals(result.isStale, false);
  assertEquals(result.reason, null);
});

Deno.test("checkSnapshotFreshness: fresh snapshot with DB date equal → not stale", () => {
  const today = new Date();
  const recent = new Date(today.getTime() - 1 * 86400000);
  const recentStr = recent.toISOString().slice(0, 10);

  const result = checkSnapshotFreshness({
    snapshotMaxActDate: recentStr,
    dbMaxActDate: recentStr, // Same as snapshot
    snapshotRecordCount: 30,
  });
  assertEquals(result.isStale, false);
});

Deno.test("extractMaxActDate: extracts max from actuaciones", () => {
  const acts = [
    { fecha_actuacion: "2026-01-10" },
    { fecha_actuacion: "2026-02-20" },
    { fecha_actuacion: "2026-01-15" },
  ];
  assertEquals(extractMaxActDate(acts), "2026-02-20");
});

Deno.test("extractMaxActDate: handles empty array", () => {
  assertEquals(extractMaxActDate([]), null);
});

Deno.test("extractMaxActDate: handles missing dates", () => {
  const acts = [{ fecha_actuacion: "" }, {}];
  assertEquals(extractMaxActDate(acts as any), null);
});

Deno.test("buildIngestionMetadata: builds correct metadata", () => {
  const meta = buildIngestionMetadata("BUSCAR", "2025-06-15", false, "SNAPSHOT_MAX_DATE_TOO_OLD");
  assertEquals(meta.cpnu_source_mode, "BUSCAR");
  assertEquals(meta.cpnu_snapshot_max_date, "2025-06-15");
  assertEquals(meta.cpnu_force_refresh, false);
  assertEquals(meta.cpnu_stale_reason, "SNAPSHOT_MAX_DATE_TOO_OLD");
  assertEquals(typeof meta.cpnu_fetched_at, "string");
});
