/**
 * Step 0 — Welcome + Scope Selection
 * Explains the PURPOSE of External Providers and asks "Who does this affect?"
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Building2, ArrowRight, Cable, Sparkles, ShieldCheck, Target, Layers, TrendingUp } from "lucide-react";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardMode } from "../WizardTypes";

interface StepWelcomeProps {
  mode: WizardMode;
  onNext: () => void;
}

const GOALS = [
  { icon: Target, title: "Mejorar cobertura", desc: "Casos donde los proveedores built-in no tienen datos digitalizados." },
  { icon: ShieldCheck, title: "Aumentar confiabilidad", desc: "Fallbacks cuando una fuente está degradada o inestable." },
  { icon: Layers, title: "Verificar corrección", desc: "Cross-check multi-proveedor para enriquecer y validar datos." },
  { icon: TrendingUp, title: "Enriquecer timelines", desc: "Más actuaciones, publicaciones, y evidencia en la UI." },
];

export function StepWelcome({ mode, onNext }: StepWelcomeProps) {
  const isPlatform = mode === "PLATFORM";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-6">
        <div className="text-center space-y-4 py-6">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 mx-auto">
            <Cable className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground">
            Asistente de Integración de Proveedores
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-sm">
            Los proveedores externos complementan los datos built-in de ATENIA (CPNU, SAMAI) sin reemplazarlos.
            Integre APIs de terceros para enriquecer actuaciones, publicaciones y timelines de sus expedientes.
          </p>
        </div>

        {/* Purpose grid */}
        <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
          {GOALS.map((g) => (
            <div key={g.title} className="flex items-start gap-2.5 p-3 bg-muted/20 border border-border/30 rounded-lg">
              <g.icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-foreground">{g.title}</p>
                <p className="text-[11px] text-muted-foreground leading-snug">{g.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Who does this affect? */}
        <div className="space-y-2 max-w-lg mx-auto">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">
            ¿A quién afecta esta integración?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className={`border-2 transition-all ${
              isPlatform
                ? "border-primary/50 bg-primary/5 shadow-md"
                : "border-border/30 bg-muted/20 opacity-60"
            }`}>
              <CardContent className="p-5 text-center space-y-3">
                <Globe className={`h-8 w-8 mx-auto ${isPlatform ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <h3 className="font-semibold text-sm">Toda la Plataforma</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Conector GLOBAL que mejora la plataforma para todas las organizaciones. Los secretos permanecen org-scoped.
                  </p>
                </div>
                {isPlatform && (
                  <Badge className="bg-primary/10 text-primary border-primary/30">
                    <Sparkles className="h-3 w-3 mr-1" /> Modo activo
                  </Badge>
                )}
              </CardContent>
            </Card>

            <Card className={`border-2 transition-all ${
              !isPlatform
                ? "border-primary/50 bg-primary/5 shadow-md"
                : "border-border/30 bg-muted/20 opacity-60"
            }`}>
              <CardContent className="p-5 text-center space-y-3">
                <Building2 className={`h-8 w-8 mx-auto ${!isPlatform ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <h3 className="font-semibold text-sm">Solo mi Organización</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Conector PRIVADO que solo afecta a tu organización. No modifica la configuración global.
                  </p>
                </div>
                {!isPlatform && (
                  <Badge className="bg-primary/10 text-primary border-primary/30">
                    <Sparkles className="h-3 w-3 mr-1" /> Modo activo
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <Button onClick={onNext} size="lg" className="gap-2">
            Comenzar <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="¿Por qué Proveedores Externos?"
          whatItDoes={isPlatform
            ? "Crea un conector GLOBAL que complementa los proveedores built-in (CPNU, SAMAI) para TODAS las organizaciones. Los secretos son org-scoped: cada org provisiona su propia instancia."
            : "Crea un conector PRIVADO para tu organización, con su propia API y configuración. No afecta a otras organizaciones."
          }
          whyItMatters={isPlatform
            ? "Los proveedores externos mejoran cobertura (casos no digitalizados), confiabilidad (fallbacks), corrección (cross-check) y enriquecen timelines para toda la plataforma."
            : "Tu organización puede integrar APIs propias para mejorar la cobertura de sus casos sin afectar al resto de la plataforma."
          }
          commonMistakes={[
            "Los proveedores externos NO reemplazan los built-in — los complementan",
            "No configurar la allowlist de dominios correctamente",
            "Usar HTTP en vez de HTTPS",
          ]}
          warnings={isPlatform ? [
            "⚠️ Los cambios GLOBALES afectan a TODAS las organizaciones de la plataforma. Los secretos permanecen org-scoped."
          ] : [
            "ℹ️ Los cambios en este modo solo afectan a tu organización."
          ]}
        />
      </div>
    </div>
  );
}
