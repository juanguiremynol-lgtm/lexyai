/**
 * Demo Telemetry Client — sends analytics events to the demo-telemetry edge function.
 * Bypasses ad blockers since it's our own backend.
 *
 * Session ID persists for 24h via localStorage.
 * No PII collected: radicado is hashed server-side.
 */

import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "andro_demo_session_id";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getOrCreateSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.id && parsed.expiresAt > Date.now()) {
        return parsed.id;
      }
    }
  } catch { /* ignore */ }

  const id = crypto.randomUUID();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      id,
      expiresAt: Date.now() + SESSION_TTL_MS,
    }));
  } catch { /* ignore */ }
  return id;
}

function getUserAgentBucket(): "mobile" | "tablet" | "desktop" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPad|tablet/i.test(ua)) return "tablet";
  if (/Mobile|Android|iPhone/i.test(ua)) return "mobile";
  return "desktop";
}

function getReferrerDomain(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const url = new URL(document.referrer);
    // Don't report self-referrals
    if (url.hostname === window.location.hostname) return undefined;
    return url.hostname;
  } catch {
    return undefined;
  }
}

function getUtmParams(): { utm_source?: string; utm_medium?: string; utm_campaign?: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || undefined,
      utm_medium: params.get("utm_medium") || undefined,
      utm_campaign: params.get("utm_campaign") || undefined,
    };
  } catch {
    return {};
  }
}

function getRoute(): string {
  const path = window.location.pathname;
  if (path === "/demo" || path.startsWith("/demo")) return "/demo";
  if (path === "/prueba" || path.startsWith("/prueba")) return "/prueba";
  // Check if embedded (iframe)
  try {
    if (window.self !== window.top) return "embed";
  } catch { return "embed"; }
  return "landing";
}

interface DemoEventPayload {
  event_name: string;
  [key: string]: unknown;
}

const eventQueue: DemoEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushEvents, 1000);
}

async function flushEvents() {
  flushTimer = null;
  if (eventQueue.length === 0) return;

  const events = eventQueue.splice(0, 10);
  const sessionId = getOrCreateSessionId();
  const route = getRoute();
  const uaBucket = getUserAgentBucket();
  const referrer = getReferrerDomain();
  const utm = getUtmParams();

  const enriched = events.map((e) => ({
    ...e,
    session_id: sessionId,
    route: e.route || route,
    user_agent_bucket: uaBucket,
    referrer_domain: referrer,
    ...utm,
  }));

  try {
    await supabase.functions.invoke("demo-telemetry", {
      body: { action: "event", events: enriched },
    });
  } catch {
    // Non-blocking — telemetry failure should never break the demo
  }
}

/**
 * Track a demo analytics event (batched, non-blocking).
 */
export function trackDemoEvent(eventName: string, props: Record<string, unknown> = {}) {
  eventQueue.push({ event_name: eventName, ...props });
  scheduleFlush();
}

/**
 * Track demo page view.
 */
export function trackDemoView(props: {
  variant?: string;
  frame?: string;
  has_radicado?: boolean;
  source?: string;
}) {
  trackDemoEvent("demo_view", props);
}

/**
 * Track demo lookup submission (radicado hashed server-side).
 */
export function trackDemoLookupSubmitted(props: {
  radicado_raw?: string;
  radicado_length: number;
  variant?: string;
  frame?: string;
}) {
  trackDemoEvent("demo_lookup_submitted", props);
}

/**
 * Track demo lookup result.
 */
export function trackDemoLookupResult(props: {
  outcome: string;
  category_inferred?: string;
  confidence?: string;
  providers_checked?: number;
  providers_with_data?: number;
  latency_ms?: number;
  has_estados?: boolean;
  has_actuaciones?: boolean;
  conflicts_count?: number;
}) {
  trackDemoEvent("demo_lookup_result", props);
}

/**
 * Track CTA click in demo.
 */
export function trackDemoCtaClicked(ctaType: string) {
  trackDemoEvent("demo_cta_clicked", { cta_type: ctaType });
}

/**
 * Get the demo session ID (for rate-limit coordination).
 */
export function getDemoSessionId(): string {
  return getOrCreateSessionId();
}
