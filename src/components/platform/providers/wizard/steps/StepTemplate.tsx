/**
 * Step 1 — Choose Template Type (new or existing connector)
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, ArrowRight, Globe, Building2, Zap } from "lucide-react";
import { WizardExplanation } from "../WizardExplanation";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { WizardMode, WizardConnector } from "../WizardTypes";

interface StepTemplateProps {
  mode: WizardMode;
  templateChoice: "NEW" | "EXISTING" | "QUICK" | null;
  selectedConnector: WizardConnector | null;
  onChoose: (choice: "NEW" | "EXISTING" | "QUICK") => void;
  onSelectConnector: (c: WizardConnector) => void;
  onNext: () => void;
}

export function StepTemplate({ mode, templateChoice, selectedConnector, onChoose, onSelectConnector, onNext }: StepTemplateProps) {
  const isPlatform = mode === "PLATFORM";

  const { data: connectors } = useQuery({
    queryKey: ["wizard-connectors", mode],
    queryFn: async () => {
      const { data } = await supabase
        .from("provider_connectors")
        .select("*")
        .eq("is_enabled", true)
        .order("name");
      return (data || []) as WizardConnector[];
    },
  });

  const canProceed = templateChoice === "NEW" || templateChoice === "QUICK" || (templateChoice === "EXISTING" && selectedConnector);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-display font-semibold text-foreground">
            ¿Cómo desea agregar el proveedor?
          </h2>
          <p className="text-sm text-muted-foreground">
            Si tiene la URL, nombre y clave del proveedor, use Quick Add. Para configuración avanzada, cree uno nuevo o use uno existente.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Quick Add — Primary option */}
          <Card
            className={`cursor-pointer border-2 transition-all hover:shadow-md sm:col-span-3 ${
              templateChoice === "QUICK" ? "border-primary/50 bg-primary/5 shadow-md" : "border-primary/20 hover:border-primary/40 bg-primary/[0.02]"
            }`}
            onClick={() => onChoose("QUICK")}
          >
            <CardContent className="p-5 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  Quick Add
                  <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">Recomendado</Badge>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Solo necesita: <strong>Nombre</strong>, <strong>URL</strong> y <strong>Master Key / API Key</strong>. Crea conector + instancia + routing automáticamente.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer border-2 transition-all hover:shadow-md ${
              templateChoice === "NEW" ? "border-primary/50 bg-primary/5" : "border-border/30 hover:border-border"
            }`}
            onClick={() => onChoose("NEW")}
          >
            <CardContent className="p-5 text-center space-y-3">
              <Plus className="h-8 w-8 mx-auto text-muted-foreground" />
              <h3 className="font-semibold text-sm">Crear Nuevo (Avanzado)</h3>
              <p className="text-xs text-muted-foreground">
                Configuración manual paso a paso
              </p>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {isPlatform ? <><Globe className="h-3 w-3 mr-1" /> Global</> : <><Building2 className="h-3 w-3 mr-1" /> Privado</>}
              </Badge>
            </CardContent>
          </Card>

          <Card
            className={`cursor-pointer border-2 transition-all hover:shadow-md ${
              templateChoice === "EXISTING" ? "border-primary/50 bg-primary/5" : "border-border/30 hover:border-border"
            }`}
            onClick={() => onChoose("EXISTING")}
          >
            <CardContent className="p-5 text-center space-y-3">
              <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
              <h3 className="font-semibold text-sm">Usar Existente</h3>
              <p className="text-xs text-muted-foreground">
                Seleccionar un conector ya creado
              </p>
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {connectors?.length || 0} disponibles
              </Badge>
            </CardContent>
          </Card>
        </div>

        {templateChoice === "EXISTING" && (
          <div className="space-y-2">
            <Select
              value={selectedConnector?.id || ""}
              onValueChange={(val) => {
                const c = connectors?.find((c) => c.id === val);
                if (c) onSelectConnector(c);
              }}
            >
              <SelectTrigger className="bg-card border-border">
                <SelectValue placeholder="Seleccionar conector..." />
              </SelectTrigger>
              <SelectContent>
                {connectors?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      {(c as any).visibility === "ORG_PRIVATE"
                        ? <Building2 className="h-3 w-3 text-muted-foreground" />
                        : <Globe className="h-3 w-3 text-muted-foreground" />
                      }
                      {c.name} ({c.key})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedConnector && (
              <div className="bg-muted/30 border border-border/50 rounded-lg p-3 text-xs space-y-1">
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{selectedConnector.name}</span> — {selectedConnector.description || "Sin descripción"}
                </p>
                <p className="text-muted-foreground">
                  Dominios: {selectedConnector.allowed_domains?.join(", ") || "ninguno"}
                </p>
                <p className="text-muted-foreground">
                  Capabilities: {selectedConnector.capabilities?.join(", ") || "ninguna"}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!canProceed} className="gap-2">
            Siguiente <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="lg:col-span-2">
        <WizardExplanation
          title="Template de Conector"
          whatItDoes="El template define las reglas de seguridad (dominios permitidos), las capacidades (ACTUACIONES, PUBLICACIONES), y el esquema de datos que usa el proveedor."
          whyItMatters="Sin un template correctamente configurado, el sistema no puede validar que las llamadas al proveedor sean seguras ni que los datos devueltos sean compatibles."
          commonMistakes={[
            "Usar un conector existente sin verificar que los dominios coincidan con la nueva API",
            "Crear conectores duplicados con el mismo key",
          ]}
        />
      </div>
    </div>
  );
}
