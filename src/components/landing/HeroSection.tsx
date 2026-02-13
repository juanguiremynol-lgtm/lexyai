import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Bot, Sparkles } from "lucide-react";
import heroLawyer from "@/assets/landing-hero-lawyer.png";

interface HeroSectionProps {
  isAuthenticated: boolean | null;
  onGoToApp: () => void;
}

export function HeroSection({ isAuthenticated, onGoToApp }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden py-24 md:py-36">
      {/* Background image — right-aligned, faded */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <img
          src={heroLawyer}
          alt=""
          aria-hidden="true"
          className="absolute right-0 top-1/2 -translate-y-1/2 h-[110%] w-auto max-w-none object-cover opacity-[0.08] dark:opacity-[0.06] select-none"
        />
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/95 to-background/40" />
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-primary/10 via-transparent to-transparent rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-accent/10 via-transparent to-transparent rounded-full blur-3xl" />
      </div>

      <div className="container max-w-7xl mx-auto px-4 relative">
        <div className="text-center max-w-4xl mx-auto space-y-6">
          <Badge variant="secondary" className="text-sm px-4 py-1.5">
            <Bot className="h-3.5 w-3.5 mr-1.5" />
            Impulsado por Andro IA
          </Badge>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
            Gestión judicial{" "}
            <span className="text-primary">inteligente</span>,{" "}
            <br className="hidden md:block" />
            simplificada por IA
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Andromeda centraliza tus procesos judiciales, automatiza alertas, 
            genera documentos y conecta múltiples fuentes de datos — todo 
            supervisado por <strong>Andro IA</strong>, tu asistente legal inteligente.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button size="lg" className="text-base h-12 px-8" onClick={onGoToApp}>
              {isAuthenticated ? "Ir al Dashboard" : "Comenzar gratis — 3 meses"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="text-base h-12 px-8" asChild>
              <a href="#features">Explorar funcionalidades</a>
            </Button>
          </div>

          <p className="text-sm text-muted-foreground pt-2">
            <Sparkles className="h-3.5 w-3.5 inline mr-1" />
            Prueba beta gratuita de 3 meses · Sin tarjeta de crédito · Solo Google Auth
          </p>
        </div>
      </div>
    </section>
  );
}
