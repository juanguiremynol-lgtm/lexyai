/**
 * Public Landing Page — Andromeda
 * 
 * Marketing/landing page showcasing Andromeda's features
 * with Andro IA as the flagship AI assistant.
 */

import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { HeroSection } from "@/components/landing/HeroSection";
import { AndroIASection } from "@/components/landing/AndroIASection";
import { WorkflowsSection } from "@/components/landing/WorkflowsSection";
import { AlertsAndEmailSection } from "@/components/landing/AlertsAndEmailSection";
import { IntegrationsSection } from "@/components/landing/IntegrationsSection";
import { CTASection } from "@/components/landing/CTASection";

export default function PublicLandingPage() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

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
      <HeroSection isAuthenticated={isAuthenticated} onGoToApp={handleGoToApp} />
      <AndroIASection />
      <WorkflowsSection />
      <AlertsAndEmailSection />
      <IntegrationsSection />
      <CTASection isAuthenticated={isAuthenticated} onGoToApp={handleGoToApp} />
    </div>
  );
}
