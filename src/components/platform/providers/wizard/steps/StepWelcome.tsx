/**
 * Step 0 — Welcome + Scope Selection
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Building2, ArrowRight, Cable, ShieldCheck, Sparkles } from "lucide-react";
import { WizardExplanation } from "../WizardExplanation";
import type { WizardMode } from "../WizardTypes";

interface StepWelcomeProps {
  mode: WizardMode;
  onNext: () => void;
}

export function StepWelcome({ mode, onNext }: StepWelcomeProps) {
  const isPlatform = mode === "PLATFORM";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-6">
        <div className="text-center space-y-4 py-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 mx-auto">
            <Cable className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground">
            Asistente de Integración de Proveedores
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Configure un proveedor externo paso a paso. Al finalizar, podrá sincronizar actuaciones y publicaciones desde APIs externas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
          <Card className={`border-2 transition-all ${
            isPlatform
              ? "border-primary/50 bg-primary/5 shadow-md"
              : "border-border/30 bg-muted/20 opacity-60"
          }`}>
            <CardContent className="p-5 text-center space-y-3">
              <Globe className={`h-8 w-8 mx-auto ${isPlatform ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <h3 className="font-semibold text-sm">Platform-Wide</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Conector global que afecta a todas las organizaciones.
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
                  Conector privado, solo visible para tu organización.
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

        <div className="flex justify-center pt-4">
          <Button onClick={onNext} size="lg" className="gap-2">
            Comenzar <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Alcance de la integración"
          whatItDoes={isPlatform
            ? "Crea un conector GLOBAL que define qué tipo de API pueden usar las organizaciones para sincronizar datos judiciales."
            : "Crea un conector PRIVADO solo para tu organización, con su propia API y configuración."
          }
          whyItMatters={isPlatform
            ? "Las rutas globales determinan el orden de consulta de proveedores para TODAS las organizaciones. Los secretos permanecen org-scoped."
            : "Tu organización puede integrar APIs propias sin afectar al resto de la plataforma."
          }
          commonMistakes={[
            "No configurar la allowlist de dominios correctamente",
            "Usar HTTP en vez de HTTPS",
            "No probar la conexión antes de activar routing",
          ]}
          warnings={isPlatform ? [
            "⚠️ Los cambios en conectores globales afectan a TODAS las organizaciones de la plataforma."
          ] : undefined}
        />
      </div>
    </div>
  );
}
