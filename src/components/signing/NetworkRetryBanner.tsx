/**
 * NetworkRetryBanner — Shows when a signing/wizard edge function call fails
 * due to a transient network error. Offers retry with exponential backoff.
 */

import { useState, useCallback, useRef } from "react";
import { WifiOff, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NetworkRetryBannerProps {
  message?: string;
  onRetry: () => Promise<void> | void;
  className?: string;
}

export function NetworkRetryBanner({
  message = "No pudimos completar la operación. Tu progreso está guardado.",
  onRetry,
  className,
}: NetworkRetryBannerProps) {
  const [retrying, setRetrying] = useState(false);
  const attemptRef = useRef(0);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    attemptRef.current += 1;
    const backoff = Math.min(1000 * Math.pow(2, attemptRef.current - 1), 10000);
    await new Promise((r) => setTimeout(r, backoff));
    try {
      await onRetry();
      attemptRef.current = 0;
    } finally {
      setRetrying(false);
    }
  }, [onRetry]);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm",
        className
      )}
    >
      <WifiOff className="h-4 w-4 text-destructive shrink-0" />
      <p className="flex-1 text-destructive/90">{message}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRetry}
        disabled={retrying}
        className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10"
      >
        {retrying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        )}
        Reintentar
      </Button>
    </div>
  );
}

/**
 * useNetworkRetry — Hook to track transient network errors and provide retry state.
 */
export function useNetworkRetry() {
  const [networkError, setNetworkError] = useState<string | null>(null);

  const wrapAsync = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        setNetworkError(null);
        return await fn();
      } catch (err: any) {
        const msg = err?.message || "Error de red";
        const isTransient =
          msg.includes("Failed to fetch") ||
          msg.includes("NetworkError") ||
          msg.includes("timeout") ||
          msg.includes("503") ||
          msg.includes("502") ||
          msg.includes("504");
        if (isTransient) {
          setNetworkError(msg);
          return null;
        }
        throw err; // re-throw non-transient errors
      }
    },
    []
  );

  const clearError = useCallback(() => setNetworkError(null), []);

  return { networkError, wrapAsync, clearError };
}
