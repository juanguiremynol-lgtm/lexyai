import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadicadoConstructor } from "@/components/utilities";
import { Calculator } from "lucide-react";

export default function Utilities() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground">Utilidades</h1>
        <p className="text-muted-foreground">Herramientas para el ejercicio profesional.</p>
      </div>

      <Tabs defaultValue="radicado" className="w-full">
        <TabsList>
          <TabsTrigger value="radicado" className="flex items-center gap-2">
            <Calculator className="h-4 w-4" />
            Constructor de Radicado
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="radicado" className="mt-6">
          <RadicadoConstructor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
