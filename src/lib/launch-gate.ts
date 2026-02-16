/**
 * Launch Gate — Single source of truth for pre-launch / live state.
 *
 * LAUNCH_AT: 2026-03-01 00:00:00 America/Bogota (UTC-5) = 2026-03-01T05:00:00Z
 *
 * Modes:
 *   AUTO          — isLive = now >= LAUNCH_AT  (default, production)
 *   FORCE_PRELAUNCH — always PRELAUNCH (testing)
 *   FORCE_LIVE      — always LIVE (emergency override)
 *
 * Env vars (optional):
 *   VITE_LAUNCH_AT_ISO   — override launch timestamp
 *   VITE_LAUNCH_MODE     — AUTO | FORCE_PRELAUNCH | FORCE_LIVE
 *   VITE_PRELAUNCH_ALLOWLIST_EMAILS — comma-separated emails for early access
 */

export const LAUNCH_AT_ISO = import.meta.env.VITE_LAUNCH_AT_ISO || "2026-03-01T05:00:00Z";

export type LaunchMode = "AUTO" | "FORCE_PRELAUNCH" | "FORCE_LIVE";
export type LaunchPhase = "PRELAUNCH" | "LIVE";

export interface LaunchState {
  isLive: boolean;
  mode: LaunchPhase;
  secondsToLaunch: number;
  launchAt: Date;
}

export function parseLaunchAt(): Date {
  return new Date(LAUNCH_AT_ISO);
}

function getConfiguredMode(): LaunchMode {
  const raw = (import.meta.env.VITE_LAUNCH_MODE || "AUTO").toUpperCase();
  if (raw === "FORCE_PRELAUNCH" || raw === "FORCE_LIVE") return raw;
  return "AUTO";
}

export function getLaunchState(now: Date = new Date()): LaunchState {
  const launchAt = parseLaunchAt();
  const configMode = getConfiguredMode();

  let isLive: boolean;
  if (configMode === "FORCE_PRELAUNCH") {
    isLive = false;
  } else if (configMode === "FORCE_LIVE") {
    isLive = true;
  } else {
    isLive = now >= launchAt;
  }

  const diffMs = launchAt.getTime() - now.getTime();
  const secondsToLaunch = Math.max(0, Math.floor(diffMs / 1000));

  return {
    isLive,
    mode: isLive ? "LIVE" : "PRELAUNCH",
    secondsToLaunch,
    launchAt,
  };
}

/**
 * Check if an email is on the pre-launch allowlist (for internal testers).
 * Does NOT grant cross-tenant access — only permits early login/signup.
 */
export function isAllowlistedEmail(email: string): boolean {
  const raw = import.meta.env.VITE_PRELAUNCH_ALLOWLIST_EMAILS || "";
  if (!raw) return false;
  const list = raw.split(",").map((e: string) => e.trim().toLowerCase());
  return list.includes(email.trim().toLowerCase());
}

/**
 * Server-side launch gate check for edge functions.
 * Uses Deno env (not Vite).
 */
export function getServerLaunchState(): LaunchState {
  const launchIso = "2026-03-01T05:00:00Z";
  const launchAt = new Date(launchIso);
  const now = new Date();
  const diffMs = launchAt.getTime() - now.getTime();

  return {
    isLive: now >= launchAt,
    mode: now >= launchAt ? "LIVE" : "PRELAUNCH",
    secondsToLaunch: Math.max(0, Math.floor(diffMs / 1000)),
    launchAt,
  };
}
