import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Bot, Sparkles } from "lucide-react";
import logo from "@/assets/andromeda-logo.png";

interface HeroSectionProps {
  isAuthenticated: boolean | null;
  onGoToApp: () => void;
}

export function HeroSection({ isAuthenticated, onGoToApp }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden py-24 md:py-36 bg-[#070b1a]">
      {/* Cosmic background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#d4a017]/5 blur-[150px]" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#d4a017]/30 to-transparent" />
      </div>

      <div className="container max-w-7xl mx-auto px-4 relative">
        <div className="text-center max-w-4xl mx-auto space-y-6">
          {/* Logo */}
          <div className="flex justify-center mb-2">
            <img
              src={logo}
              alt="Andromeda – Su Universo Legal"
              className="h-52 md:h-[17rem] w-auto object-contain drop-shadow-[0_0_40px_rgba(212,160,23,0.3)]"
            />
          </div>

          <Badge className="text-sm px-4 py-1.5 bg-[#0ea5e9]/10 text-[#0ea5e9] border-[#0ea5e9]/30 hover:bg-[#0ea5e9]/20">
            <Bot className="h-3.5 w-3.5 mr-1.5" />
            Impulsado por Andro IA
          </Badge>

          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] text-white">
            Gestión judicial{" "}
            <span className="text-[#d4a017]">inteligente</span>,{" "}
            <br className="hidden md:block" />
            simplificada por IA
          </h1>

          <p className="text-lg md:text-xl text-[#a0b4d0] max-w-2xl mx-auto">
            Andromeda centraliza tus procesos judiciales, automatiza alertas, 
            genera documentos y conecta múltiples fuentes de datos — todo 
            supervisado por <strong className="text-white">Andro IA</strong>, tu asistente legal inteligente.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
            <Button
              size="lg"
              className="text-base h-12 px-8 bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)] hover:shadow-[0_0_40px_rgba(212,160,23,0.5)]"
              onClick={onGoToApp}
            >
              {isAuthenticated ? "Ir al Dashboard" : "Comenzar gratis — 3 meses"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base h-12 px-8 border-[#0ea5e9]/40 text-[#0ea5e9] hover:bg-[#0ea5e9]/10 hover:border-[#0ea5e9]/60 bg-transparent"
              asChild
            >
              <a href="#features">Explorar funcionalidades</a>
            </Button>
          </div>

          <p className="text-sm text-[#a0b4d0]/60 pt-2">
            <Sparkles className="h-3.5 w-3.5 inline mr-1 text-[#d4a017]" />
            Prueba beta gratuita de 3 meses · Sin tarjeta de crédito · Solo Google Auth
          </p>
        </div>
      </div>

      {/* Bottom fade into next section */}
      <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
}
