/**
 * TermsReAcceptanceGuard — Wraps protected routes.
 * If the user hasn't accepted the current terms version, shows the acceptance modal.
 * Blocks all app usage until accepted (re-acceptance on version change).
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

      const accepted = await hasAcceptedCurrentTerms();
      setNeedsAcceptance(!accepted);
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
