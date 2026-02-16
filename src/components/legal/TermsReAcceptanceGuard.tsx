/**
 * TermsReAcceptanceGuard — Wraps protected routes.
 * If the user hasn't accepted the current terms version, shows the acceptance modal.
 * 
 * This is the UX layer. Server-side enforcement is provided by:
 * - DB function: user_has_accepted_current_terms()  
 * - DB trigger: profiles.pending_terms_acceptance flag
 * - The guard checks BOTH the DB function AND the pending flag
 */
import { ReactNode, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TermsAcceptanceModal } from "./TermsAcceptanceModal";
import { recordTermsAcceptance, hasAcceptedCurrentTerms } from "@/lib/terms-service";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  children: ReactNode;
}

export function TermsReAcceptanceGuard({ children }: Props) {
  const [checking, setChecking] = useState(true);
  const [needsAcceptance, setNeedsAcceptance] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const check = async () => {
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

      // Check both: DB function + profile pending flag
      const [accepted, profileResult] = await Promise.all([
        hasAcceptedCurrentTerms(),
        supabase
          .from("profiles")
          .select("pending_terms_acceptance")
          .eq("id", session.user.id)
          .maybeSingle()
      ]);

      const pendingFlag = profileResult.data?.pending_terms_acceptance ?? false;
      
      // Need acceptance if: server says not accepted OR profile is flagged
      setNeedsAcceptance(!accepted || pendingFlag);
      setChecking(false);
    };
    check();
  }, []);

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

  if (needsAcceptance) {
    return <TermsAcceptanceModal onAccept={handleAccept} loading={saving} isReAcceptance />;
  }

  return <>{children}</>;
}
