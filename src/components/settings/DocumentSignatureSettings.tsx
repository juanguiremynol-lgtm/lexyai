/**
 * DocumentSignatureSettings — Combined settings page for Documents & Digital Signature.
 * Contains: Branding, Poder Especial template, Contrato de Servicios template.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, FileText } from "lucide-react";
import { DocumentBrandingSettings } from "./DocumentBrandingSettings";
import { DocumentTemplateEditor } from "./DocumentTemplateEditor";

export function DocumentSignatureSettings() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="branding">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="branding">
            <ImageIcon className="h-4 w-4 mr-1" />
            Marca y Logo
          </TabsTrigger>
          <TabsTrigger value="poder">
            <FileText className="h-4 w-4 mr-1" />
            Poder Especial
          </TabsTrigger>
          <TabsTrigger value="contrato">
            <FileText className="h-4 w-4 mr-1" />
            Contrato de Servicios
          </TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <DocumentBrandingSettings />
        </TabsContent>

        <TabsContent value="poder">
          <DocumentTemplateEditor templateType="poder_especial" />
        </TabsContent>

        <TabsContent value="contrato">
          <DocumentTemplateEditor templateType="contrato_servicios" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
