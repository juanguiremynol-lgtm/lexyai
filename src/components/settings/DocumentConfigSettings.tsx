/**
 * DocumentConfigSettings — Per-org/user document configuration:
 * field requirement overrides, section toggles, ID type defaults.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Settings2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { useDocumentConfiguration, type IdType } from "@/hooks/use-document-configuration";
import { LegalDocumentType, LEGAL_DOCUMENT_TYPE_LABELS, LEGAL_TEMPLATES } from "@/lib/legal-document-templates";

const CONFIGURABLE_DOC_TYPES: LegalDocumentType[] = ["contrato_servicios", "poder_especial", "paz_y_salvo"];

const SECTION_LABELS: Record<string, string> = {
  honorarios: "Cláusula de Honorarios",
  confidencialidad: "Cláusula de Confidencialidad",
  datos_personales: "Cláusula de Tratamiento de Datos",
  controversias: "Cláusula de Resolución de Controversias",
  firma_aceptacion: "Firma de Aceptación del Apoderado",
};

export function DocumentConfigSettings() {
  const { organization } = useOrganization();
  const { isAdmin } = useOrganizationMembership(organization?.id || null);
  const [selectedDocType, setSelectedDocType] = useState<LegalDocumentType>("contrato_servicios");

  const {
    config,
    isLoading,
    save,
    isSaving,
    isFieldRequired,
  } = useDocumentConfiguration(selectedDocType, organization?.id);

  const [localConfig, setLocalConfig] = useState(config);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const template = LEGAL_TEMPLATES[selectedDocType];
  const editableFields = template.variables.filter(v => v.editable && v.source !== "computed");

  const handleFieldOverride = (fieldKey: string, key: "required" | "hidden", value: boolean) => {
    setLocalConfig(prev => ({
      ...prev,
      field_overrides: {
        ...prev.field_overrides,
        [fieldKey]: {
          ...prev.field_overrides[fieldKey],
          [key]: value,
        },
      },
    }));
  };

  const handleSectionToggle = (sectionKey: string, enabled: boolean) => {
    setLocalConfig(prev => ({
      ...prev,
      enabled_sections: {
        ...prev.enabled_sections,
        [sectionKey]: enabled,
      },
    }));
  };

  const handleSave = () => {
    save({
      ...localConfig,
      scope: (isAdmin && organization) ? "org" : "user",
    });
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Configuración de Documentos
          </CardTitle>
          <CardDescription>
            Configure qué campos son requeridos, opcionales u ocultos para cada tipo de documento.
            {isAdmin && organization && (
              <Badge variant="outline" className="ml-2">Configuración organizacional</Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Document type selector */}
          <div className="space-y-2">
            <Label>Tipo de documento</Label>
            <div className="flex gap-2">
              {CONFIGURABLE_DOC_TYPES.map(type => (
                <Button
                  key={type}
                  variant={selectedDocType === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDocType(type)}
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  {LEGAL_DOCUMENT_TYPE_LABELS[type]}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Identity type defaults */}
          {selectedDocType === "contrato_servicios" && (
            <>
              <div className="space-y-3">
                <Label className="font-medium">Tipo de identificación predeterminado</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Cliente (Mandante)</Label>
                    <Select
                      value={localConfig.default_client_id_type}
                      onValueChange={(v) => setLocalConfig(prev => ({ ...prev, default_client_id_type: v as IdType }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CC">Cédula de ciudadanía (C.C.)</SelectItem>
                        <SelectItem value="NIT">NIT (Persona jurídica)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Abogado (Mandatario)</Label>
                    <Select
                      value={localConfig.default_lawyer_id_type}
                      onValueChange={(v) => setLocalConfig(prev => ({ ...prev, default_lawyer_id_type: v as IdType }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CC">Cédula de ciudadanía (C.C.)</SelectItem>
                        <SelectItem value="NIT">NIT (Persona jurídica)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Field requirement overrides */}
          <div className="space-y-3">
            <Label className="font-medium">Campos del documento</Label>
            <p className="text-xs text-muted-foreground">
              Active o desactive la obligatoriedad de cada campo. Los campos marcados como "oculto" no aparecerán en el asistente.
            </p>
            <div className="space-y-2">
              {editableFields.map(field => {
                const override = localConfig.field_overrides[field.key];
                const isHidden = override?.hidden === true;
                const isReq = override?.required !== undefined ? override.required : field.required;

                return (
                  <div key={field.key} className="flex items-center justify-between py-2 px-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                    <div className="flex-1">
                      <span className="text-sm font-medium">{field.label}</span>
                      {field.description && (
                        <p className="text-xs text-muted-foreground">{field.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs text-muted-foreground">Requerido</Label>
                        <Switch
                          checked={isReq}
                          onCheckedChange={(v) => handleFieldOverride(field.key, "required", v)}
                          disabled={isHidden}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs text-muted-foreground">Oculto</Label>
                        <Switch
                          checked={isHidden}
                          onCheckedChange={(v) => handleFieldOverride(field.key, "hidden", v)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sections toggle (contract-specific) */}
          {selectedDocType === "contrato_servicios" && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="font-medium">Secciones del contrato</Label>
                <p className="text-xs text-muted-foreground">
                  Active o desactive secciones opcionales del contrato.
                </p>
                <div className="space-y-2">
                  {Object.entries(SECTION_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between py-2 px-3 rounded-lg border border-border/50">
                      <span className="text-sm">{label}</span>
                      <Switch
                        checked={localConfig.enabled_sections[key] !== false}
                        onCheckedChange={(v) => handleSectionToggle(key, v)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar configuración
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
