/**
 * DocumentSignatureSettings — Combined settings page for Documents & Digital Signature.
 * Contains: Litigation Email, Branding, Templates, DOCX Upload, Config.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, FileText, Mail, Ban, Settings2, Upload } from "lucide-react";
import { DocumentBrandingSettings } from "./DocumentBrandingSettings";
import { DocumentTemplateEditor } from "./DocumentTemplateEditor";
import { LitigationEmailSettings } from "./LitigationEmailSettings";
import { DocumentConfigSettings } from "./DocumentConfigSettings";
import { DocxTemplateUpload } from "@/components/documents/DocxTemplateUpload";

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
          <TabsTrigger value="doc-config">
            <Settings2 className="h-4 w-4 mr-1" />
            Configuración
          </TabsTrigger>
        </TabsList>

        <TabsContent value="litigation-email">
          <LitigationEmailSettings />
        </TabsContent>

        <TabsContent value="branding">
          <DocumentBrandingSettings />
        </TabsContent>

        <TabsContent value="poder">
          <div className="space-y-6">
            <DocxTemplateUpload documentType="poder_especial" />
            <DocumentTemplateEditor templateType="poder_especial" />
          </div>
        </TabsContent>

        <TabsContent value="contrato">
          <div className="space-y-6">
            <DocxTemplateUpload documentType="contrato_servicios" />
            <DocumentTemplateEditor templateType="contrato_servicios" />
          </div>
        </TabsContent>

        <TabsContent value="notificacion-personal">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30">
              <Ban className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Herramienta de redacción únicamente
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Esta plataforma NO entrega notificaciones judiciales a partes contrarias ni terceros.
                  El documento finalizado se envía únicamente al correo de litigio del abogado emisor.
                  La entrega debe realizarse mediante un servicio certificado (ej. Servientrega Digital).
                </p>
              </div>
            </div>
            <DocumentTemplateEditor templateType="notificacion_personal" />
          </div>
        </TabsContent>

        <TabsContent value="notificacion-aviso">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30">
              <Ban className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Herramienta de redacción únicamente
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Esta plataforma NO publica ni entrega avisos judiciales a terceros.
                  El documento finalizado se envía únicamente al correo de litigio del abogado emisor.
                  La publicación debe realizarse mediante medios certificados.
                </p>
              </div>
            </div>
            <DocumentTemplateEditor templateType="notificacion_por_aviso" />
          </div>
        </TabsContent>

        <TabsContent value="doc-config">
          <DocumentConfigSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
