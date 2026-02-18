/**
 * Platform Atenia AI Page
 * 
 * Combines the Comprehensive Audit Wizard with the Supervisor Panel
 * (which includes Global Master Sync, diagnostics, and operational tools).
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AteniaComprehensiveAuditWizard } from "@/components/platform/atenia-ai/AteniaComprehensiveAuditWizard";
import { AteniaAISupervisorPanel } from "@/components/platform/AteniaAISupervisorPanel";
import { FlaskConical, Activity } from "lucide-react";

export default function PlatformAteniaAIPage() {
  return (
    <Tabs defaultValue="supervisor" className="w-full space-y-4">
      <TabsList>
        <TabsTrigger value="supervisor" className="gap-1.5">
          <Activity className="h-4 w-4" />
          Supervisor & Sync
        </TabsTrigger>
        <TabsTrigger value="audit" className="gap-1.5">
          <FlaskConical className="h-4 w-4" />
          Auditoría Integral
        </TabsTrigger>
      </TabsList>
      <TabsContent value="supervisor">
        <AteniaAISupervisorPanel />
      </TabsContent>
      <TabsContent value="audit">
        <AteniaComprehensiveAuditWizard />
      </TabsContent>
    </Tabs>
  );
}
