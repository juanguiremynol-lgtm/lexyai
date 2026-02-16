/**
 * Public Landing Page — Andromeda
 * 
 * In PRELAUNCH: Shows countdown hero + waitlist + marketing sections.
 * In LIVE: Shows normal landing with auth CTAs.
 */

import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLaunchGate } from "@/hooks/use-launch-gate";

import { HeroSection } from "@/components/landing/HeroSection";
import { CountdownHero } from "@/components/launch/CountdownHero";
import { DemoRadicadoSection } from "@/components/demo/DemoRadicadoSection";
import { AndroIASection } from "@/components/landing/AndroIASection";
import { WorkflowsSection } from "@/components/landing/WorkflowsSection";
import { AlertsAndEmailSection } from "@/components/landing/AlertsAndEmailSection";
import { IntegrationsSection } from "@/components/landing/IntegrationsSection";
import { ColombiaJudicialSection } from "@/components/landing/ColombiaJudicialSection";
import { CTASection } from "@/components/landing/CTASection";

export default function PublicLandingPage() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const { isLive } = useLaunchGate();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleGoToApp = () => {
    navigate(isAuthenticated ? "/app/dashboard" : "/auth");
  };

  return (
    <div className="min-h-screen bg-background">
      {isLive ? (
        <HeroSection isAuthenticated={isAuthenticated} onGoToApp={handleGoToApp} />
      ) : (
        <CountdownHero />
      )}
      <DemoRadicadoSection />
      <AndroIASection />
      <WorkflowsSection />
      <AlertsAndEmailSection />
      <IntegrationsSection />
      <ColombiaJudicialSection />
      <CTASection isAuthenticated={isAuthenticated} onGoToApp={handleGoToApp} />
    </div>
  );
}
