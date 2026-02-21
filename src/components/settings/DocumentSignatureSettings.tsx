/**
 * DocumentSignatureSettings — Combined settings page for Documents & Digital Signature.
 * Contains: Litigation Email, Branding, Poder Especial template, Contrato de Servicios template.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, FileText, Mail } from "lucide-react";
import { DocumentBrandingSettings } from "./DocumentBrandingSettings";
import { DocumentTemplateEditor } from "./DocumentTemplateEditor";
import { LitigationEmailSettings } from "./LitigationEmailSettings";

export function DocumentSignatureSettings() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="litigation-email">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="litigation-email">
            <Mail className="h-4 w-4 mr-1" />
            Email de Litigio
          </TabsTrigger>
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
          <TabsTrigger value="notificacion-personal">
            <FileText className="h-4 w-4 mr-1" />
            Notificación Personal
          </TabsTrigger>
          <TabsTrigger value="notificacion-aviso">
            <FileText className="h-4 w-4 mr-1" />
            Notificación por Aviso
          </TabsTrigger>
        </TabsList>

        <TabsContent value="litigation-email">
          <LitigationEmailSettings />
        </TabsContent>

        <TabsContent value="branding">
          <DocumentBrandingSettings />
        </TabsContent>

        <TabsContent value="poder">
          <DocumentTemplateEditor templateType="poder_especial" />
        </TabsContent>

        <TabsContent value="contrato">
          <DocumentTemplateEditor templateType="contrato_servicios" />
        </TabsContent>

        <TabsContent value="notificacion-personal">
          <DocumentTemplateEditor templateType="notificacion_personal" />
        </TabsContent>

        <TabsContent value="notificacion-aviso">
          <DocumentTemplateEditor templateType="notificacion_por_aviso" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
