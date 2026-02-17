import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Settings2 } from "lucide-react";
import { EmailClientPage } from "@/components/email/EmailClientPage";
import { EmailSettingsPanel } from "@/components/email/EmailSettingsPanel";

export default function EmailPage() {
  return (
    <div className="container mx-auto py-6 px-4 h-full">
      <div className="mb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" />
          Email
        </h1>
        <p className="text-muted-foreground text-sm">
          Gestiona tu correo electrónico directamente desde Andromeda
        </p>
      </div>

      <Tabs defaultValue="inbox" className="h-full">
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5">
            <Mail className="h-4 w-4" /> Correo
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings2 className="h-4 w-4" /> Configuración
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <EmailClientPage />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <EmailSettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
