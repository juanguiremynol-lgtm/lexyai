/**
 * Public Landing Page
 * 
 * Marketing/landing page for unauthenticated visitors.
 * Features: Hero section, workflow features, CTAs
 */

import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Scale,
  Landmark,
  Gavel,
  FileText,
  Bell,
  Calendar,
  Shield,
  Zap,
  ArrowRight,
  CheckCircle,
  Users,
  BarChart3,
  Clock,
} from "lucide-react";
import ateniaLogo from "@/assets/atenia-logo.png";

const WORKFLOW_FEATURES = [
  {
    icon: Scale,
    title: "Procesos CGP / Laboral",
    description: "Monitoreo de Estados vía ICARUS. Términos legales, alertas automáticas y seguimiento de etapas procesales.",
    badge: "Estados",
    color: "emerald",
    notificationSource: "CPNU (primario) / SAMAI (fallback)",
  },
  {
    icon: Landmark,
    title: "Contencioso CPACA",
    description: "Gestión integral de procesos administrativos. Cálculo de caducidad, traslados y audiencias.",
    badge: "SAMAI",
    color: "indigo",
    notificationSource: "SAMAI (primario)",
  },
  {
    icon: Gavel,
    title: "Tutelas",
    description: "Seguimiento de acciones de tutela con plazos estrictos. Notificaciones de impugnación y fallo.",
    badge: "Tutelas API",
    color: "purple",
    notificationSource: "Tutelas API (primario) / CPNU (fallback)",
  },
  {
    icon: Shield,
    title: "Procesos Penales (Ley 906)",
    description: "Clasificación de fases penales, seguimiento de audiencias y publicaciones procesales.",
    badge: "Publicaciones",
    color: "rose",
    notificationSource: "Publicaciones Procesales (primario)",
  },
];

const BENEFITS = [
  {
    icon: Bell,
    title: "Alertas Inteligentes",
    description: "Recibe notificaciones antes de vencimientos críticos",
  },
  {
    icon: Calendar,
    title: "Términos Automatizados",
    description: "Cálculo preciso de plazos legales con días hábiles",
  },
  {
    icon: BarChart3,
    title: "Dashboard Unificado",
    description: "Visualiza todos tus procesos en un solo lugar",
  },
  {
    icon: Clock,
    title: "Historial Completo",
    description: "Línea de tiempo de todas las actuaciones",
  },
];

export default function PublicLandingPage() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    };
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleGoToApp = () => {
    if (isAuthenticated) {
      navigate("/app/dashboard");
    } else {
      navigate("/auth");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={ateniaLogo} alt="ATENIA" className="h-10" />
          </Link>
          
          <nav className="hidden md:flex items-center gap-6">
            <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Precios
            </Link>
          </nav>
          
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button onClick={() => navigate("/app/dashboard")}>
                Ir a la App
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link to="/auth">Iniciar sesión</Link>
                </Button>
                <Button asChild>
                  <Link to="/join">Solicitar acceso</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 md:py-32">
        {/* Background decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-primary/10 via-transparent to-transparent rounded-full blur-3xl" />
          <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-primary/5 via-transparent to-transparent rounded-full blur-3xl" />
        </div>
        
        <div className="container max-w-7xl mx-auto px-4 relative">
          <div className="text-center max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-4">
              Asistente Jurídico Digital
            </Badge>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Gestión de procesos judiciales{" "}
              <span className="text-primary">inteligente</span>
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              ATENIA automatiza el seguimiento de tus procesos legales. 
              Términos, alertas, actuaciones y audiencias en una sola plataforma.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={handleGoToApp}>
                {isAuthenticated ? "Ir al Dashboard" : "Comenzar ahora"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/pricing">Ver planes</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow Features */}
      <section className="py-20 bg-muted/30">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Flujos de Trabajo Especializados</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Cada tipo de proceso tiene su propia lógica, fuentes de datos y reglas. 
              ATENIA adapta su comportamiento automáticamente.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            {WORKFLOW_FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card key={feature.title} className="relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-1 h-full bg-${feature.color}-500`} />
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-${feature.color}-500/10`}>
                        <Icon className={`h-6 w-6 text-${feature.color}-600`} />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{feature.title}</CardTitle>
                        <Badge variant="outline" className="mt-1 text-xs">
                          {feature.badge}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm mb-3">
                      {feature.description}
                    </CardDescription>
                    <p className="text-xs text-muted-foreground">
                      <strong>Fuente:</strong> {feature.notificationSource}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Grid */}
      <section className="py-20">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">¿Por qué ATENIA?</h2>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <Card key={benefit.title} className="text-center p-6">
                  <div className="inline-flex p-3 rounded-full bg-primary/10 mb-4">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">{benefit.description}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container max-w-7xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-4">
            ¿Listo para optimizar tu práctica legal?
          </h2>
          <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
            Únete a los despachos que ya confían en ATENIA para el seguimiento de sus procesos.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" variant="secondary" onClick={handleGoToApp}>
              {isAuthenticated ? "Ir al Dashboard" : "Comenzar gratis"}
            </Button>
            <Button size="lg" variant="ghost" className="text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10" asChild>
              <a href="mailto:ventas@atenia.co">Contactar ventas</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-8">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={ateniaLogo} alt="ATENIA" className="h-8 opacity-70" />
              <span className="text-sm text-muted-foreground">
                © {new Date().getFullYear()} ATENIA. Todos los derechos reservados.
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <a href="mailto:soporte@atenia.co" className="hover:text-foreground transition-colors">
                Soporte
              </a>
              <Link to="/pricing" className="hover:text-foreground transition-colors">
                Precios
              </Link>
              <Link to="/auth" className="hover:text-foreground transition-colors">
                Iniciar sesión
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
