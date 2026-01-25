import { useState, useCallback } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { checkRateLimit, getRateLimitStatus, incrementRateLimit, type RateLimitResult } from "@/lib/rate-limiter";
import { toast } from "sonner";

export interface UseRateLimitOptions {
  showToast?: boolean;
}

export function useRateLimit(limitKey: string, options: UseRateLimitOptions = {}) {
  const { organization } = useOrganization();
  const [isChecking, setIsChecking] = useState(false);
  const [lastResult, setLastResult] = useState<RateLimitResult | null>(null);

  const organizationId = organization?.id;

  /**
   * Check if action is allowed and consume a slot
   */
  const checkAndConsume = useCallback(async (): Promise<boolean> => {
    if (!organizationId) {
      console.warn("[use-rate-limit] No organization ID");
      return true; // Fail open if no org
    }

    setIsChecking(true);
    try {
      const count = await incrementRateLimit(organizationId, limitKey);
      const config = await import("@/lib/rate-limiter").then(m => m.RATE_LIMITS[limitKey]);
      
      if (!config) {
        return true;
      }

      const allowed = count <= config.maxRequests;
      const windowMs = config.windowMinutes * 60 * 1000;
      const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
      const resetAt = new Date(windowStart.getTime() + windowMs);

      const result: RateLimitResult = {
        allowed,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt,
        message: allowed ? undefined : `Has alcanzado el límite de ${config.maxRequests} operaciones. Intenta de nuevo más tarde.`,
      };

      setLastResult(result);

      if (!allowed && options.showToast !== false) {
        toast.error(result.message || "Límite de velocidad excedido");
      }

      return allowed;
    } catch (err) {
      console.error("[use-rate-limit] Error:", err);
      return true; // Fail open
    } finally {
      setIsChecking(false);
    }
  }, [organizationId, limitKey, options.showToast]);

  /**
   * Check current status without consuming
   */
  const checkStatus = useCallback(async (): Promise<RateLimitResult | null> => {
    if (!organizationId) {
      return null;
    }

    setIsChecking(true);
    try {
      const result = await getRateLimitStatus(organizationId, limitKey);
      setLastResult(result);
      return result;
    } catch (err) {
      console.error("[use-rate-limit] Error checking status:", err);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, [organizationId, limitKey]);

  return {
    checkAndConsume,
    checkStatus,
    isChecking,
    lastResult,
    isAllowed: lastResult?.allowed ?? true,
    remaining: lastResult?.remaining ?? -1,
    resetAt: lastResult?.resetAt ?? null,
  };
}
