import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot } from "lucide-react";

interface CTASectionProps {
  isAuthenticated: boolean | null;
  onGoToApp: () => void;
}

export function CTASection({ isAuthenticated, onGoToApp }: CTASectionProps) {
  return (
    <section className="py-24 md:py-32 bg-primary text-primary-foreground">
      <div className="container max-w-7xl mx-auto px-4 text-center">
        <div className="inline-flex p-3 rounded-full bg-primary-foreground/10 mb-6">
          <Bot className="h-8 w-8" />
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Deja que Andro IA trabaje por ti
        </h2>
        <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
          Únete a los despachos y abogados que ya confían en Andromeda para la gestión 
          inteligente de sus procesos judiciales.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button
            size="lg"
            variant="secondary"
            className="text-base h-12 px-8"
            onClick={onGoToApp}
          >
            {isAuthenticated ? "Ir al Dashboard" : "Comenzar gratis — 3 meses"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 text-base h-12 px-8"
            asChild
          >
            <a href="mailto:ventas@andromeda.legal">Contactar ventas</a>
          </Button>
        </div>
      </div>
    </section>
  );
}
