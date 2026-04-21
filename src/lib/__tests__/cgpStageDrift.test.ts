/**
 * CGP Stage Drift Guard
 *
 * Enforces the alias-aware invariant between the two CGP stage catalogs:
 *   - Inference catalog: CGP_FILING_STAGES ∪ CGP_PROCESS_STAGES (granular)
 *   - Dashboard catalog: CGP_STAGES (coarse Kanban buckets)
 *
 * The catalogs use intentionally different vocabularies. They are bridged
 * by `mapInferenceStageToDashboard()` in `src/lib/cgp-stages.ts`.
 *
 * Without this test, adding a stage to one catalog without updating the
 * mapping would cause the Dashboard to render the wrong (or no) Kanban
 * column with no compile-time or runtime error.
 */
import { describe, it, expect } from 'vitest';
import {
  CGP_FILING_STAGES,
  CGP_PROCESS_STAGES,
} from '@/lib/workflow-constants';
import {
  CGP_STAGES,
  mapInferenceStageToDashboard,
} from '@/lib/cgp-stages';

describe('CGP stage drift guard', () => {
  const inferenceKeys = [
    ...Object.keys(CGP_FILING_STAGES),
    ...Object.keys(CGP_PROCESS_STAGES),
  ];

  it('Every inference stage key has a valid CGP_STAGES bucket mapping', () => {
    const failures: string[] = [];

    for (const key of inferenceKeys) {
      const mapping = mapInferenceStageToDashboard(key);

      if (mapping === null) {
        failures.push(
          `[missing-mapping] inference key "${key}" has no entry in ` +
          `mapInferenceStageToDashboard() (cgp-stages.ts).`
        );
        continue;
      }

      if (!mapping.phase) {
        failures.push(
          `[missing-phase] inference key "${key}" mapped to a falsy phase.`
        );
      }

      if (!(mapping.bucketKey in CGP_STAGES)) {
        failures.push(
          `[unknown-bucket] inference key "${key}" maps to bucketKey ` +
          `"${mapping.bucketKey}" which does not exist in CGP_STAGES ` +
          `(cgp-stages.ts). Known buckets: ${Object.keys(CGP_STAGES).join(', ')}.`
        );
      }
    }

    expect(
      failures,
      `CGP catalog drift detected:\n  - ${failures.join('\n  - ')}`
    ).toEqual([]);
  });
});