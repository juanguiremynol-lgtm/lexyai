/**
 * AddHearingDialog — Add hearing from catalog or free text
 */
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useHearingTypes } from "@/hooks/use-hearing-catalog";
import { useCreateWorkItemHearing } from "@/hooks/use-work-item-hearings-v2";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workItemId: string;
  organizationId: string;
  jurisdiction: string;
}

export function AddHearingDialog({ open, onOpenChange, workItemId, organizationId, jurisdiction }: Props) {
  const [mode, setMode] = useState<"catalog" | "custom">("catalog");
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [customName, setCustomName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [modality, setModality] = useState("");

  const { data: hearingTypes = [] } = useHearingTypes(jurisdiction);
  const createMutation = useCreateWorkItemHearing();

  const handleSubmit = () => {
    createMutation.mutate(
      {
        work_item_id: workItemId,
        organization_id: organizationId,
        hearing_type_id: mode === "catalog" ? selectedTypeId || undefined : undefined,
        custom_name: mode === "custom" ? customName : undefined,
        scheduled_at: scheduledAt || undefined,
        modality: modality || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      }
    );
  };

  const resetForm = () => {
    setMode("catalog");
    setSelectedTypeId("");
    setCustomName("");
    setScheduledAt("");
    setModality("");
  };

  const isValid = mode === "catalog" ? !!selectedTypeId : !!customName.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar Audiencia</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as "catalog" | "custom")} className="flex gap-4">
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="catalog" id="catalog" />
              <Label htmlFor="catalog">Del catálogo</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="custom" />
              <Label htmlFor="custom">Personalizada</Label>
            </div>
          </RadioGroup>

          {mode === "catalog" && (
            <ScrollArea className="h-48 border rounded-lg p-2">
              <div className="space-y-1">
                {hearingTypes.map((ht) => (
                  <button
                    key={ht.id}
                    onClick={() => setSelectedTypeId(ht.id)}
                    className={`w-full text-left p-2 rounded-md text-sm transition-colors ${
                      selectedTypeId === ht.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{ht.short_name}</span>
                      {ht.legal_basis && (
                        <Badge variant="outline" className="text-[10px]">{ht.legal_basis}</Badge>
                      )}
                    </div>
                    {ht.typical_purpose && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{ht.typical_purpose}</p>
                    )}
                  </button>
                ))}
                {hearingTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay tipos de audiencia para esta jurisdicción
                  </p>
                )}
              </div>
            </ScrollArea>
          )}

          {mode === "custom" && (
            <div>
              <Label>Nombre de la audiencia</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Ej: Audiencia especial de conciliación"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Fecha (opcional)</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Modalidad</Label>
              <Select value={modality} onValueChange={setModality}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="presencial">Presencial</SelectItem>
                  <SelectItem value="virtual">Virtual</SelectItem>
                  <SelectItem value="mixta">Mixta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!isValid || createMutation.isPending}>
            {createMutation.isPending ? "Creando..." : "Agregar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
