import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { bogotaDay, dailyWindowDue, dailyCompletion } from './dailyCompletion.ts';
Deno.test('failure and partial never consume a successful daily completion', () => {
  assertEquals(dailyCompletion(1, 0, 1, 0, 0), 'FAILED');
  assertEquals(dailyCompletion(10, 9, 1, 0, 0), 'PARTIAL');
  assertEquals(dailyCompletion(1, 0, 0, 1, 0), 'PARTIAL');
  assertEquals(dailyCompletion(1, 1, 0, 0, 0), 'SUCCESS');
});
Deno.test('Bogota day and 07 window only gate automatic initial invocation', () => {
  assertEquals(bogotaDay(new Date('2026-10-22T04:59:00Z')), '2026-10-21');
  assertEquals(dailyWindowDue('CRON', new Date('2026-10-21T05:01:00Z')), false);
  assertEquals(dailyWindowDue('MANUAL', new Date('2026-10-21T05:01:00Z')), true);
  assertEquals(dailyWindowDue('RECOVERY', new Date('2026-10-21T05:01:00Z')), true);
  assertEquals(dailyWindowDue('CRON', new Date('2026-10-21T12:00:00Z')), true);
});