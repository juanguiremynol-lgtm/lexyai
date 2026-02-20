/**
 * CourtHeaderSection — Court addressing UI for Poder Especial wizard.
 * Supports three modes: specific court, reparto, and generic.
 */

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, X, Building2, AlertCircle } from "lucide-react";
import {
  CourtAddressingMode,
  CourtHeaderData,
  buildCourtHeaderHtml,
  COURT_TYPE_OPTIONS,
} from "@/lib/court-header-utils";

interface CourtHeaderSectionProps {
  data: CourtHeaderData;
  onChange: (data: CourtHeaderData) => void;
  onSaveCourtEmail?: (email: string, name: string, city?: string) => void;
  inferredEmail?: string | null;
}

export function CourtHeaderSection({ data, onChange, onSaveCourtEmail, inferredEmail }: CourtHeaderSectionProps) {
  const [saveToDb, setSaveToDb] = useState(false);

  const update = (patch: Partial<CourtHeaderData>) => {
    onChange({ ...data, ...patch });
  };

  const previewHtml = buildCourtHeaderHtml(data);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-primary" />
        <Label className="text-sm font-medium">Dirigido a</Label>
      </div>

      <RadioGroup
        value={data.mode}
        onValueChange={(v) => update({ mode: v as CourtAddressingMode })}
        className="space-y-2"
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="specific" id="court-specific" />
          <Label htmlFor="court-specific" className="text-sm cursor-pointer">
            Juzgado específico (caso ya radicado)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="reparto" id="court-reparto" />
          <Label htmlFor="court-reparto" className="text-sm cursor-pointer">
            Juzgado por reparto (caso por radicar)
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="generic" id="court-generic" />
          <Label htmlFor="court-generic" className="text-sm cursor-pointer">
            Genérico (sin especificar juzgado)
          </Label>
        </div>
      </RadioGroup>

      {/* Specific mode fields */}
      {data.mode === "specific" && (
        <div className="space-y-3 pl-1">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Nombre del juez</Label>
              {data.judge_name && (
                <Button variant="ghost" size="sm" className="h-5 px-1 text-xs text-muted-foreground" onClick={() => update({ judge_name: "" })}>
                  <X className="h-3 w-3 mr-0.5" /> Eliminar
                </Button>
              )}
            </div>
            <Input
              value={data.judge_name || ""}
              onChange={(e) => update({ judge_name: e.target.value })}
              placeholder="Nombre del juez (opcional)"
            />
            {data.judge_name && (
              <p className="text-[11px] text-muted-foreground">
                ℹ️ Inferido de los datos del expediente. Puede editar o eliminar.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Nombre del juzgado</Label>
            <Input
              value={data.court_name || ""}
              onChange={(e) => update({ court_name: e.target.value })}
              placeholder="Juzgado 3 Civil del Circuito de Medellín"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Ciudad</Label>
            <Input
              value={data.court_city || ""}
              onChange={(e) => update({ court_city: e.target.value })}
              placeholder="Medellín"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Email del juzgado</Label>
              {data.court_email && (
                <Button variant="ghost" size="sm" className="h-5 px-1 text-xs text-muted-foreground" onClick={() => update({ court_email: "" })}>
                  <X className="h-3 w-3 mr-0.5" /> Eliminar
                </Button>
              )}
            </div>
            <Input
              type="email"
              value={data.court_email || ""}
              onChange={(e) => update({ court_email: e.target.value })}
              placeholder="juz03cctomedel@cendoj.ramajudicial.gov.co"
            />
            {inferredEmail && data.court_email === inferredEmail && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-primary" />
                Inferido de nuestra base de datos. Verifique que sea correcto.
              </p>
            )}
            {!data.court_email && !inferredEmail && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-destructive" />
                No encontramos el email de este juzgado. Si lo conoce, ingréselo aquí.
              </p>
            )}

            {data.court_email && onSaveCourtEmail && (
              <div className="flex items-center space-x-2 mt-1">
                <Checkbox
                  id="save-court-email"
                  checked={saveToDb}
                  onCheckedChange={(c) => {
                    setSaveToDb(!!c);
                    if (c && data.court_email && data.court_name) {
                      onSaveCourtEmail(data.court_email, data.court_name, data.court_city);
                    }
                  }}
                />
                <Label htmlFor="save-court-email" className="text-xs cursor-pointer text-muted-foreground">
                  Guardar este email para futuros documentos
                </Label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reparto mode fields */}
      {data.mode === "reparto" && (
        <div className="space-y-3 pl-1">
          <div className="space-y-1">
            <Label className="text-xs">Ciudad del circuito / municipio</Label>
            <Input
              value={data.court_city || ""}
              onChange={(e) => update({ court_city: e.target.value })}
              placeholder="Medellín"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo de juzgado</Label>
            <Select
              value={data.court_type_reparto || "Civil del Circuito"}
              onValueChange={(v) => update({ court_type_reparto: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COURT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Vista previa del encabezado</Label>
        <Card className="bg-muted/30">
          <CardContent className="py-3 px-4 text-sm font-serif leading-relaxed">
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
