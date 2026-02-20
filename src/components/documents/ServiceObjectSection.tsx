/**
 * ServiceObjectSection — Service object / caso description for contract wizard
 * with quick templates and free-text editing
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { SERVICE_OBJECT_TEMPLATES } from "@/lib/honorarios-utils";

export interface ServiceObjectSectionProps {
  value: string;
  onChange: (val: string) => void;
  opposingParty?: string;
  courtCity?: string;
  workflowType?: string;
}

export function ServiceObjectSection({
  value,
  onChange,
  opposingParty,
  courtCity,
  workflowType,
}: ServiceObjectSectionProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  const handleTemplateSelect = (templateIdx: string) => {
    setSelectedTemplate(templateIdx);
    if (templateIdx === 'custom') return;
    const template = SERVICE_OBJECT_TEMPLATES[Number(templateIdx)];
    if (!template) return;

    // Auto-replace bracketed placeholders with known values
    let text = template.text;
    if (opposingParty) {
      text = text.replace('[Banco de Bogotá S.A.]', opposingParty)
        .replace('[describir hechos]', `la relación con ${opposingParty}`)
        .replace('[describir pretensiones]', `relación laboral con ${opposingParty}`)
        .replace('[especificar derechos]', `[especificar derechos]`);
    }
    if (courtCity) {
      text = text.replace(/\[la jurisdicción civil del circuito de Medellín\]/g, `la jurisdicción civil del circuito de ${courtCity}`)
        .replace(/Medellín/g, courtCity);
    }

    onChange(text);
  };

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Objeto del contrato</Label>

      <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Seleccionar plantilla rápida..." />
        </SelectTrigger>
        <SelectContent>
          {SERVICE_OBJECT_TEMPLATES.map((t, i) => (
            <SelectItem key={i} value={String(i)} className="text-xs">{t.label}</SelectItem>
          ))}
          <SelectItem value="custom" className="text-xs">Personalizado</SelectItem>
        </SelectContent>
      </Select>

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder="Describa el servicio legal que prestará al cliente..."
        className="text-sm"
      />

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Puede editar libremente. Los textos entre corchetes [ ] requieren personalización.</span>
      </div>
    </div>
  );
}
