/**
 * insertIgnoringDuplicates — safe replacement for `.upsert(..., { onConflict })`
 * on tables whose dedupe index is PARTIAL (e.g. `work_item_acts`
 * `idx_work_item_acts_unique ... WHERE is_archived = false`).
 *
 * PostgREST turns `onConflict` into `ON CONFLICT (cols)`, which Postgres can
 * only infer against a NON-partial unique index. On these tables the statement
 * always fails with 42P10 ("no unique or exclusion constraint matching the ON
 * CONFLICT specification") and every row is silently lost.
 *
 * Strategy: plain bulk insert; if it fails with a unique violation (23505),
 * retry row by row and skip only the duplicate rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface InsertIgnoringDuplicatesResult {
  inserted: number;
  duplicates: number;
  /** Non-duplicate failure, if any. */
  error: { message: string; code?: string } | null;
}

const UNIQUE_VIOLATION = "23505";

export async function insertIgnoringDuplicates(
  client: SupabaseClient<any, any, any>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<InsertIgnoringDuplicatesResult> {
  if (!rows.length) return { inserted: 0, duplicates: 0, error: null };

  const bulk = await client.from(table).insert(rows as any).select("id");
  if (!bulk.error) {
    return { inserted: bulk.data?.length ?? rows.length, duplicates: 0, error: null };
  }
  if (bulk.error.code !== UNIQUE_VIOLATION) {
    return { inserted: 0, duplicates: 0, error: bulk.error };
  }

  let inserted = 0;
  let duplicates = 0;
  let firstError: { message: string; code?: string } | null = null;
  for (const row of rows) {
    const one = await client.from(table).insert(row as any).select("id");
    if (!one.error) {
      inserted += one.data?.length ?? 1;
    } else if (one.error.code === UNIQUE_VIOLATION) {
      duplicates += 1;
    } else if (!firstError) {
      firstError = one.error;
    }
  }
  return { inserted, duplicates, error: firstError };
}
