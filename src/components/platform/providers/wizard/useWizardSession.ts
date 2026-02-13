/**
 * useWizardSession — Creates and manages a wizard session for the External Provider Wizard.
 * The session ID is passed as `x-atenia-wizard-session` header to all provider edge functions.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WizardMode } from "./WizardTypes";

interface UseWizardSessionResult {
  sessionId: string | null;
  isCreating: boolean;
  error: string | null;
  /** Invoke a Supabase edge function with the wizard session header attached */
  invokeWithSession: (
    functionName: string,
    options?: { body?: unknown }
  ) => Promise<{ data: any; error: any }>;
}

export function useWizardSession(
  mode: WizardMode,
  organizationId: string | null
): UseWizardSessionResult {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdRef = useRef(false);

  useEffect(() => {
    if (sessionId) return;

    // Reset ref on each effect run so StrictMode re-mount works correctly
    let cancelled = false;

    async function createSession() {
      if (createdRef.current) return;
      createdRef.current = true;

      setIsCreating(true);
      setError(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setError("Authentication required");
          return;
        }

        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours

        const { data, error: insertErr } = await supabase
          .from("provider_wizard_sessions")
          .insert({
            mode,
            created_by: user.id,
            organization_id: mode === "ORG" ? organizationId : null,
            status: "ACTIVE",
            expires_at: expiresAt,
          })
          .select("id")
          .single();

        if (insertErr) {
          if (!cancelled) setError(insertErr.message);
          return;
        }

        if (!cancelled && data) {
          setSessionId(data.id);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to create wizard session");
      } finally {
        // Always clear loading state — even if cancelled by StrictMode unmount,
        // the next mount will re-run and this prevents stuck spinner.
        setIsCreating(false);
      }
    }

    createSession();
    return () => {
      cancelled = true;
      // Allow re-creation on StrictMode re-mount
      createdRef.current = false;
    };
  }, [mode, organizationId, sessionId]);

  const invokeWithSession = useCallback(
    async (functionName: string, options?: { body?: unknown }) => {
      const headers: Record<string, string> = {};
      if (sessionId) {
        headers["x-atenia-wizard-session"] = sessionId;
      }
      return supabase.functions.invoke(functionName, {
        body: options?.body as any,
        headers,
      });
    },
    [sessionId]
  );

  return { sessionId, isCreating, error, invokeWithSession };
}
