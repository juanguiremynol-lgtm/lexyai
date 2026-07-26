/**
 * Dedicated cron authentication.
 *
 * Scheduled jobs used to authenticate with the project's anon key, which is a
 * public, rotatable credential shared with every browser. They now send a
 * dedicated secret in the `x-cron-key` header instead.
 */
export const CRON_HEADER = "x-cron-key";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the request carries the dedicated cron secret. */
export function isCronCaller(req: Request): boolean {
  const expected = Deno.env.get("CRON_SERVICE_KEY");
  if (!expected) return false;
  const provided = req.headers.get(CRON_HEADER);
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}
