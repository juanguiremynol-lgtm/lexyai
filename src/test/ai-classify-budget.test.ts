/**
 * Budget guard for aiClassifyEmail: every real provider attempt — including
 * retries — must count against AI_CALLS_PER_RUN, and exhaustion must degrade
 * to null (regex fallback) without ever dropping or misclassifying the email.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aiClassifyEmail,
  newAiGatewayState,
  AI_CALLS_PER_RUN,
} from "../../supabase/functions/_shared/aiClassifyEmail.ts";

const INPUT = { subject: "Despacho judicial", bodyText: "Auto del juzgado" };
const OK_BODY = {
  choices: [{ message: { content: '{"subtype":"OTRO_JUDICIAL","radicados":[],"instancia":null,"audiencia_fecha":null,"termino_dias":null,"resumen":"x"}' } }],
};

function mockFetchSequence(responses: Array<{ status: number; body?: unknown }>) {
  const calls: number[] = [];
  const mock = vi.fn(async () => {
    calls.push(1);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(next.body ?? OK_BODY), { status: next.status });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe("aiClassifyEmail budget", () => {
  it("counts each retry as a real provider call", async () => {
    // Two 429s then success: 3 real attempts must consume 3 budget units.
    mockFetchSequence([{ status: 429 }, { status: 429 }, { status: 200 }]);
    const state = newAiGatewayState();
    const result = await aiClassifyEmail(INPUT, state, "key");
    expect(result?.subtype).toBe("OTRO_JUDICIAL");
    expect(state.calls).toBe(3);
  });

  it("never exceeds the budget even with persistent 429 retries", async () => {
    mockFetchSequence([{ status: 429 }]);
    const state = newAiGatewayState();
    state.calls = AI_CALLS_PER_RUN - 1; // one unit left
    const result = await aiClassifyEmail(INPUT, state, "key");
    expect(result).toBeNull();
    expect(state.calls).toBe(AI_CALLS_PER_RUN);
    expect(state.disabled).toBe(false); // 429 is not a credit exhaustion
  });

  it("returns null without any fetch when the budget is already exhausted", async () => {
    const mock = mockFetchSequence([{ status: 200 }]);
    const state = newAiGatewayState();
    state.calls = AI_CALLS_PER_RUN;
    const result = await aiClassifyEmail(INPUT, state, "key");
    expect(result).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("402 disables the gateway for the rest of the run and stops retrying", async () => {
    const mock = mockFetchSequence([{ status: 402 }]);
    const state = newAiGatewayState();
    const first = await aiClassifyEmail(INPUT, state, "key");
    const second = await aiClassifyEmail(INPUT, state, "key");
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(state.disabled).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1); // no retry, no further calls
  });
});
