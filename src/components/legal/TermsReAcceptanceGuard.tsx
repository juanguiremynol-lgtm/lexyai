/**
 * TermsReAcceptanceGuard — Wraps protected routes.
 * If the user hasn't accepted the current terms version, shows the acceptance modal.
 * 
 * This is the UX layer. Server-side enforcement is provided by:
 * - DB function: user_has_accepted_current_terms()  
 * - DB trigger: profiles.pending_terms_acceptance flag
 * - The server current-version check is authoritative over stale profile flags
 */
import { ReactNode, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TermsAcceptanceModal } from "./TermsAcceptanceModal";
import { recordTermsAcceptance, hasAcceptedCurrentTerms } from "@/lib/terms-service";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

export function TermsReAcceptanceGuard({ children }: Props) {
  const [checking, setChecking] = useState(true);
  const [needsAcceptance, setNeedsAcceptance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    const check = async () => {
      setChecking(true);
      setCheckError(null);
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setChecking(false);
        return;
      }
      
      // Check if platform admin — they bypass terms
      const { data: adminRecord } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      
      if (adminRecord) {
        setChecking(false);
        return;
      }

      // The current-version server check is authoritative; a stale profile
      // flag must not force an already recorded current acceptance again.
      setNeedsAcceptance(!(await hasAcceptedCurrentTerms()));
      } catch (error) {
        setCheckError(error instanceof Error ? error.message : "No se pudo comprobar tu aceptación.");
      }
      setChecking(false);
    };
    check();
  }, [checkAttempt]);

  const handleAccept = async (data: {
    checkboxTerms: boolean;
    checkboxAge: boolean;
    checkboxMarketing: boolean;
  }) => {
    setSaving(true);
    const result = await recordTermsAcceptance({
      checkboxTerms: data.checkboxTerms,
      checkboxAge: data.checkboxAge,
      checkboxMarketing: data.checkboxMarketing,
      acceptanceMethod: "reacceptance_web",
      scrollGated: true,
    });

    if (result.success) {
      setNeedsAcceptance(false);
      toast.success("Términos aceptados correctamente");
    } else {
      toast.error(result.error || "Error al registrar aceptación");
    }
    setSaving(false);
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (checkError) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6">
      <p role="alert" className="text-foreground">{checkError}</p>
      <Button onClick={() => setCheckAttempt(value => value + 1)}>Reintentar</Button>
    </div>
  );

  if (needsAcceptance) {
    return <TermsAcceptanceModal onAccept={handleAccept} loading={saving} isReAcceptance />;
  }

  return <>{children}</>;
}
