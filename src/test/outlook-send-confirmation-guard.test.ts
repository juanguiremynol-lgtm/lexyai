/**
 * Regression guard for Control 1: no component may reach the `outlook-send`
 * edge function without the two-step confirmation screen owned by
 * `src/hooks/use-outlook-send.tsx`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const HOOK = "src/hooks/use-outlook-send.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk("src");

describe("outlook-send confirmation guard", () => {
  it("only the guarded hook invokes the outlook-send edge function", () => {
    const offenders = files.filter(
      (f) => f !== HOOK && /invoke\(\s*["'`]outlook-send["'`]/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the guarded hook never exposes the raw mutation", () => {
    const src = readFileSync(HOOK, "utf8");
    expect(src).not.toMatch(/export\s+(const|function)\s+useRawOutlookSendMutation/);
    expect(src).toMatch(/requestSend/);
    expect(src).toMatch(/confirmationDialog/);
  });

  it("every consumer of useOutlookSend renders the confirmation dialog", () => {
    const consumers = files.filter(
      (f) => f !== HOOK && /useOutlookSend\s*\(/.test(readFileSync(f, "utf8")),
    );
    expect(consumers.length).toBeGreaterThan(0);
    for (const file of consumers) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} must render confirmationDialog`).toMatch(/\.confirmationDialog\}/);
      // and must not attempt to bypass it with a direct mutation call
      expect(src, `${file} must not call mutate() on the send hook`).not.toMatch(
        /(send|outlookSend)\.mutate(Async)?\(/,
      );
    }
  });
});
