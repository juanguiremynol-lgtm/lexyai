import { z } from "zod";

const cursorSchema = z.object({
  v: z.literal(1), scope: z.string(),
  value: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))?$/).nullable(),
  id: z.string().uuid(),
}).strict();

// Listing cursors carry only a sort boundary, never identity or feed checkpoints.
export function readPageCursor(cursor: string | undefined, scope: string) {
  if (!cursor) return null;
  try {
    const bytes = Uint8Array.from(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const parsed = cursorSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (parsed.scope !== scope) throw new Error();
    return parsed;
  } catch { throw new Error("Cursor inválido o incompatible con los filtros."); }
}

export function pageBoundary(column: string, cursor: NonNullable<ReturnType<typeof readPageCursor>>) {
  return cursor.value === null
    ? `and(${column}.is.null,id.lt.${cursor.id})`
    : `${column}.lt.${cursor.value},and(${column}.eq.${cursor.value},id.lt.${cursor.id}),${column}.is.null`;
}

export function finishPage<T extends { id: string }>(rows: T[], limit: number, column: keyof T, scope: string) {
  const items = rows.slice(0, limit);
  const has_more = rows.length > limit;
  const last = items[items.length - 1];
  const next_cursor = has_more && last
    ? btoa(Array.from(new TextEncoder().encode(JSON.stringify({ v: 1, scope, value: last[column] ?? null, id: last.id })), b => String.fromCharCode(b)).join(""))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : null;
  return { items, has_more, next_cursor };
}