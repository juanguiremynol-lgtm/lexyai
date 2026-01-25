import { supabase } from "@/integrations/supabase/client";
import { logHealthEvent } from "./system-health";

export interface RateLimitConfig {
  key: string;
  maxRequests: number;
  windowMinutes: number;
}

// Default rate limits
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  UPLOAD_ICARUS_PROCESSES: {
    key: 'UPLOAD_ICARUS_PROCESSES',
    maxRequests: 10,
    windowMinutes: 10,
  },
  UPLOAD_ICARUS_ESTADOS: {
    key: 'UPLOAD_ICARUS_ESTADOS',
    maxRequests: 15,
    windowMinutes: 10,
  },
  SYNC_EXTERNAL_API: {
    key: 'SYNC_EXTERNAL_API',
    maxRequests: 30,
    windowMinutes: 60,
  },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  message?: string;
}

/**
 * Check and consume a rate limit slot
 */
export async function checkRateLimit(
  organizationId: string,
  limitKey: string
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[limitKey];
  if (!config) {
    console.warn(`[rate-limiter] Unknown rate limit key: ${limitKey}`);
    return { allowed: true, remaining: -1, resetAt: new Date() };
  }

  const windowMs = config.windowMinutes * 60 * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  try {
    // Try to upsert the rate limit counter
    const { data, error } = await supabase
      .from("rate_limits")
      .upsert(
        {
          organization_id: organizationId,
          key: config.key,
          window_start: windowStart.toISOString(),
          count: 1,
        },
        {
          onConflict: 'organization_id,key,window_start',
          ignoreDuplicates: false,
        }
      )
      .select("count")
      .single();

    if (error) {
      // If conflict, get current and increment
      if (error.code === '23505') {
        // Get current count first
        const { data: current } = await supabase
          .from("rate_limits")
          .select("id, count")
          .eq("organization_id", organizationId)
          .eq("key", config.key)
          .eq("window_start", windowStart.toISOString())
          .maybeSingle();

        if (!current) {
          console.error("[rate-limiter] Failed to find existing record");
          return { allowed: true, remaining: -1, resetAt };
        }

        // Increment
        const { data: updated, error: updateError } = await supabase
          .from("rate_limits")
          .update({ count: current.count + 1 })
          .eq("id", current.id)
          .select("count")
          .single();

        if (updateError) {
          console.error("[rate-limiter] Failed to update:", updateError);
          return { allowed: true, remaining: -1, resetAt };
        }

        const count = (updated as { count: number })?.count || 0;
        const remaining = Math.max(0, config.maxRequests - count);
        const allowed = count <= config.maxRequests;

        if (!allowed) {
          await logRateLimitExceeded(organizationId, config.key);
        }

        return {
          allowed,
          remaining,
          resetAt,
          message: allowed ? undefined : `Límite excedido. Intente de nuevo ${formatTimeUntil(resetAt)}.`,
        };
      }

      console.error("[rate-limiter] Failed to check:", error);
      // Fail open
      return { allowed: true, remaining: -1, resetAt };
    }

    const count = (data as { count: number })?.count || 1;
    const remaining = Math.max(0, config.maxRequests - count);
    const allowed = count <= config.maxRequests;

    if (!allowed) {
      await logRateLimitExceeded(organizationId, config.key);
    }

    return {
      allowed,
      remaining,
      resetAt,
      message: allowed ? undefined : `Límite excedido. Intente de nuevo ${formatTimeUntil(resetAt)}.`,
    };
  } catch (err) {
    console.error("[rate-limiter] Unexpected error:", err);
    // Fail open
    return { allowed: true, remaining: -1, resetAt: new Date() };
  }
}

/**
 * Increment rate limit counter via SQL (workaround for atomic increment)
 */
export async function incrementRateLimit(
  organizationId: string,
  limitKey: string
): Promise<number> {
  const config = RATE_LIMITS[limitKey];
  if (!config) return 0;

  const windowMs = config.windowMinutes * 60 * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  try {
    // First, try to get existing
    const { data: existing } = await supabase
      .from("rate_limits")
      .select("id, count")
      .eq("organization_id", organizationId)
      .eq("key", config.key)
      .eq("window_start", windowStart.toISOString())
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data: updated } = await supabase
        .from("rate_limits")
        .update({ count: existing.count + 1 })
        .eq("id", existing.id)
        .select("count")
        .single();
      return (updated as { count: number })?.count || 0;
    } else {
      // Insert new
      const { data: inserted } = await supabase
        .from("rate_limits")
        .insert({
          organization_id: organizationId,
          key: config.key,
          window_start: windowStart.toISOString(),
          count: 1,
        })
        .select("count")
        .single();
      return (inserted as { count: number })?.count || 1;
    }
  } catch {
    return 0;
  }
}

/**
 * Check rate limit without consuming (read-only)
 */
export async function getRateLimitStatus(
  organizationId: string,
  limitKey: string
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[limitKey];
  if (!config) {
    return { allowed: true, remaining: -1, resetAt: new Date() };
  }

  const windowMs = config.windowMinutes * 60 * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  try {
    const { data } = await supabase
      .from("rate_limits")
      .select("count")
      .eq("organization_id", organizationId)
      .eq("key", config.key)
      .eq("window_start", windowStart.toISOString())
      .maybeSingle();

    const count = (data as { count: number } | null)?.count || 0;
    const remaining = Math.max(0, config.maxRequests - count);
    const allowed = count < config.maxRequests;

    return {
      allowed,
      remaining,
      resetAt,
    };
  } catch {
    return { allowed: true, remaining: -1, resetAt };
  }
}

async function logRateLimitExceeded(organizationId: string, key: string): Promise<void> {
  await logHealthEvent('RATE_LIMIT', 'WARN', {
    message: `Rate limit exceeded: ${key}`,
    metadata: { key },
    organizationId,
  });
}

function formatTimeUntil(date: Date): string {
  const ms = date.getTime() - Date.now();
  if (ms < 60000) return 'en menos de 1 minuto';
  const minutes = Math.ceil(ms / 60000);
  if (minutes === 1) return 'en 1 minuto';
  return `en ${minutes} minutos`;
}
