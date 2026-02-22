/**
 * PlatformHearingsCatalog — Super admin catalog page with tabs for types + flows
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, ListOrdered, Activity } from "lucide-react";
import { HearingTypesTable } from "./HearingTypesTable";
import { FlowTemplatesManager } from "./FlowTemplatesManager";
import { CatalogHealthDashboard } from "./CatalogHealthDashboard";

export function PlatformHearingsCatalog() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight">Catálogo de Audiencias</h1>
        <p className="text-white/50 text-sm mt-1">
          Gestión de tipos de audiencia y plantillas de flujo por jurisdicción colombiana.
        </p>
      </div>

      <Tabs defaultValue="types" className="space-y-4">
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="types" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/60 gap-2">
            <BookOpen className="h-4 w-4" /> Tipos de audiencia
          </TabsTrigger>
          <TabsTrigger value="flows" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/60 gap-2">
            <ListOrdered className="h-4 w-4" /> Plantillas de flujo
          </TabsTrigger>
          <TabsTrigger value="health" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/60 gap-2">
            <Activity className="h-4 w-4" /> Salud del catálogo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="types">
          <HearingTypesTable />
        </TabsContent>

        <TabsContent value="flows">
          <FlowTemplatesManager />
        </TabsContent>

        <TabsContent value="health">
          <CatalogHealthDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
