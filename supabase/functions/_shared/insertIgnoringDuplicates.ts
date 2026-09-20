/**
 * Deno mirror of src/lib/db/insert-ignoring-duplicates.ts.
 *
 * `.upsert(rows, { onConflict: "work_item_id,hash_fingerprint" })` cannot work
 * on work_item_acts / work_item_publicaciones: their dedupe indexes are PARTIAL
 * (`WHERE is_archived = false`), so Postgres rejects the inferred ON CONFLICT
 * with 42P10 and NO row is written. Insert plainly and tolerate 23505 instead.
 */
// deno-lint-ignore-file no-explicit-any

export interface InsertIgnoringDuplicatesResult {
  inserted: number;
  insertedIds: string[];
  duplicates: number;
  error: { message: string; code?: string } | null;
}

const UNIQUE_VIOLATION = "23505";

export async function insertIgnoringDuplicates(
  db: any,
  table: string,
  rows: Record<string, unknown>[],
): Promise<InsertIgnoringDuplicatesResult> {
  if (!rows.length) return { inserted: 0, insertedIds: [], duplicates: 0, error: null };

  const bulk = await db.from(table).insert(rows).select("id");
  if (!bulk.error) {
    const ids = (bulk.data ?? []).map((r: any) => r.id);
    return { inserted: ids.length, insertedIds: ids, duplicates: 0, error: null };
  }
  if (bulk.error.code !== UNIQUE_VIOLATION) {
    return { inserted: 0, insertedIds: [], duplicates: 0, error: bulk.error };
  }

  const insertedIds: string[] = [];
  let duplicates = 0;
  let firstError: { message: string; code?: string } | null = null;
  for (const row of rows) {
    const one = await db.from(table).insert(row).select("id");
    if (!one.error) {
      for (const r of one.data ?? []) insertedIds.push(r.id);
    } else if (one.error.code === UNIQUE_VIOLATION) {
      duplicates += 1;
    } else if (!firstError) {
      firstError = one.error;
    }
  }
  return { inserted: insertedIds.length, insertedIds, duplicates, error: firstError };
}
