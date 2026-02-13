/**
 * WizardSessionContext — Provides the wizard session ID and an invoke helper
 * that automatically attaches the x-atenia-wizard-session header.
 */

import { createContext, useContext } from "react";
import { supabase } from "@/integrations/supabase/client";

interface WizardSessionContextValue {
  sessionId: string | null;
  /** Invoke a Supabase edge function with the wizard session header attached */
  invokeWithSession: (
    functionName: string,
    options?: { body?: unknown }
  ) => Promise<{ data: any; error: any }>;
}

const WizardSessionContext = createContext<WizardSessionContextValue>({
  sessionId: null,
  invokeWithSession: (fn, opts) => supabase.functions.invoke(fn, { body: opts?.body as any }),
});

export const WizardSessionProvider = WizardSessionContext.Provider;

export function useWizardSessionContext() {
  return useContext(WizardSessionContext);
}
