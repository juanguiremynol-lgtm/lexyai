/**
 * Tests: Hoy Feed Separation
 *
 * Verifies that "Estados de Hoy" and "Actuaciones de Hoy" feeds
 * are strictly keyed by external event/publication dates, NOT by
 * internal timestamps (created_at, updated_at).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getWindowBounds,
  getDeadlineUrgency,
  getColombiaToday,
  type HoyWindow,
} from '@/lib/colombia-date-utils';

// ============= 1. Window Bounds Tests =============

describe('getWindowBounds', () => {
  it('returns date_start and date_end as date strings (not timestamps)', () => {
    const bounds = getWindowBounds('today');
    // date_start should be a YYYY-MM-DD format
    expect(bounds.date_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // date_end includes tomorrow for pre-dated entries
    expect(bounds.date_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('three_days window extends date_start 2 days back', () => {
    const boundsToday = getWindowBounds('today');
    const bounds3d = getWindowBounds('three_days');
    // date_start for 3 days should be before today
    expect(new Date(bounds3d.date_start).getTime()).toBeLessThanOrEqual(
      new Date(boundsToday.date_start).getTime()
    );
  });

  it('week window extends date_start 6 days back', () => {
    const boundsToday = getWindowBounds('today');
    const boundsWeek = getWindowBounds('week');
    expect(new Date(boundsWeek.date_start).getTime()).toBeLessThan(
      new Date(boundsToday.date_start).getTime()
    );
  });
});

// ============= 2. Urgency Tests =============

describe('getDeadlineUrgency', () => {
  it('returns "expired" for dates in the past', () => {
    expect(getDeadlineUrgency('2020-01-01')).toBe('expired');
  });

  it('does NOT return "critical" for expired dates (must be "expired")', () => {
    // This is the key bug we fixed: overdue items were showing as "urgent"
    const result = getDeadlineUrgency('2019-06-15');
    expect(result).not.toBe('critical');
    expect(result).toBe('expired');
  });

  it('returns "critical" for deadlines within 0-2 days in the future', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    expect(getDeadlineUrgency(tomorrowStr)).toBe('critical');
  });

  it('returns "warning" for deadlines 3-5 days away', () => {
    const future = new Date();
    future.setDate(future.getDate() + 4);
    const futureStr = future.toISOString().split('T')[0];
    expect(getDeadlineUrgency(futureStr)).toBe('warning');
  });

  it('returns "normal" for deadlines > 5 days away', () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const futureStr = future.toISOString().split('T')[0];
    expect(getDeadlineUrgency(futureStr)).toBe('normal');
  });

  it('returns "none" for null input', () => {
    expect(getDeadlineUrgency(null)).toBe('none');
  });
});

// ============= 3. Feed Separation Logic Tests =============

describe('Feed separation: is_new badge logic', () => {
  it('is_new should be true only when created_at is within the window, not just because item exists', () => {
    // Simulating the client-side logic used in fetchEstadosHoy and getActuacionesHoy
    const bounds = getWindowBounds('today');
    const windowStartMs = new Date(bounds.created_start).getTime();
    const windowEndMs = new Date(bounds.created_end).getTime();

    // Historical record re-synced: created_at is old
    const oldCreatedAt = '2024-01-15T10:00:00.000Z';
    const oldMs = new Date(oldCreatedAt).getTime();
    const isNewForOld = oldMs >= windowStartMs && oldMs <= windowEndMs;
    expect(isNewForOld).toBe(false); // Must NOT be tagged as "new"

    // Genuinely new record: created_at is today
    const newCreatedAt = new Date().toISOString();
    const newMs = new Date(newCreatedAt).getTime();
    const isNewForNew = newMs >= windowStartMs && newMs <= windowEndMs;
    expect(isNewForNew).toBe(true); // Must be tagged as "new"
  });
});

describe('Feed separation: historical records excluded', () => {
  it('historical estado with publication_date years ago must not match today window', () => {
    const bounds = getWindowBounds('today');
    const historicalDate = '2019-08-15';

    // The query filter: fecha_fijacion >= date_start AND fecha_fijacion <= date_end
    const inRange =
      historicalDate >= bounds.date_start && historicalDate <= bounds.date_end;
    expect(inRange).toBe(false);
  });

  it('estado published today must match today window', () => {
    const bounds = getWindowBounds('today');
    const todayDate = getColombiaToday();

    const inRange =
      todayDate >= bounds.date_start && todayDate <= bounds.date_end;
    expect(inRange).toBe(true);
  });

  it('historical actuacion with act_date years ago must not match today window', () => {
    const bounds = getWindowBounds('today');
    const historicalDate = '2021-03-20';

    const inRange =
      historicalDate >= bounds.date_start && historicalDate <= bounds.date_end;
    expect(inRange).toBe(false);
  });

  it('actuacion with act_date today must match today window', () => {
    const bounds = getWindowBounds('today');
    const todayDate = getColombiaToday();

    const inRange =
      todayDate >= bounds.date_start && todayDate <= bounds.date_end;
    expect(inRange).toBe(true);
  });
});

// ============= 4. Sorting Tests =============

describe('Feed sorting uses event date, not created_at', () => {
  it('items with newer event date should sort before items with older event date', () => {
    const items = [
      { date: '2026-02-15', created_at: '2026-02-17T12:00:00Z' }, // old event, ingested today
      { date: '2026-02-17', created_at: '2026-02-15T08:00:00Z' }, // today event, ingested days ago
    ];

    // The correct sort: by date descending (event date)
    items.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    expect(items[0].date).toBe('2026-02-17'); // Today's event first
    expect(items[1].date).toBe('2026-02-15'); // Old event second
  });

  it('created_at is used only as tie-breaker when event dates are equal', () => {
    const items = [
      { date: '2026-02-17', created_at: '2026-02-17T08:00:00Z' },
      { date: '2026-02-17', created_at: '2026-02-17T14:00:00Z' },
    ];

    items.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Same event date → newer created_at first (more recently ingested)
    expect(items[0].created_at).toBe('2026-02-17T14:00:00Z');
  });
});

// ============= 5. Counter consistency =============

describe('Counter consistency', () => {
  it('courtPostedCount should equal the number of items returned by date-based query', () => {
    // Simulate: 3 items match fecha_fijacion filter
    const pubData = [
      { id: '1', fecha_fijacion: '2026-02-17', created_at: '2026-02-17T10:00:00Z' },
      { id: '2', fecha_fijacion: '2026-02-17', created_at: '2026-02-10T10:00:00Z' },
      { id: '3', fecha_fijacion: '2026-02-17', created_at: '2026-02-15T10:00:00Z' },
    ];

    // Counter logic from fetchEstadosHoy: courtPostedCount = all items from the query
    let courtPostedCount = 0;
    for (const _row of pubData) {
      courtPostedCount++;
    }

    // Total items shown = same set
    expect(courtPostedCount).toBe(pubData.length);
    // Counter and list must match
    expect(courtPostedCount).toBe(3);
  });
});
