import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, History } from "lucide-react";
import { DocumentGenerator } from "./DocumentGenerator";
import { DocumentHistory } from "./DocumentHistory";

interface Client {
  id: string;
  name: string;
  id_number: string | null;
  email: string | null;
}

interface ClientDocumentsTabProps {
  client: Client;
}

export function ClientDocumentsTab({ client }: ClientDocumentsTabProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("generate");

  const handleDocumentSaved = () => {
    // Refresh history and optionally switch to history tab
    queryClient.invalidateQueries({ queryKey: ["client-documents", client.id] });
    setActiveTab("history");
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="mb-4">
        <TabsTrigger value="generate" className="gap-2">
          <FileText className="h-4 w-4" />
          Generar Documento
        </TabsTrigger>
        <TabsTrigger value="history" className="gap-2">
          <History className="h-4 w-4" />
          Historial
        </TabsTrigger>
      </TabsList>

      <TabsContent value="generate">
        <DocumentGenerator client={client} onDocumentSaved={handleDocumentSaved} />
      </TabsContent>

      <TabsContent value="history">
        <DocumentHistory clientId={client.id} clientName={client.name} />
      </TabsContent>
    </Tabs>
  );
}
