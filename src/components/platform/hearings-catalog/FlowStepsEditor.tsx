/**
 * FlowStepsEditor — Ordered step list for a flow template with reorder + add/remove
 */
import { useState } from "react";
import { useFlowTemplateSteps, useHearingTypes, type HearingFlowTemplateStep } from "@/hooks/use-hearing-catalog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { GripVertical, Plus, Trash2, ArrowUp, ArrowDown, Flag } from "lucide-react";

interface Props {
  templateId: string;
  jurisdiction: string;
}

export function FlowStepsEditor({ templateId, jurisdiction }: Props) {
  const { data: steps = [], isLoading } = useFlowTemplateSteps(templateId);
  const { data: hearingTypes = [] } = useHearingTypes(jurisdiction);
  const queryClient = useQueryClient();
  const [addingType, setAddingType] = useState<string>("");

  const usedTypeIds = new Set(steps.map(s => s.hearing_type_id));
  const availableTypes = hearingTypes.filter(t => !usedTypeIds.has(t.id));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["hearing-flow-steps", templateId] });

  const handleAddStep = async () => {
    if (!addingType) return;
    const maxOrder = steps.length > 0 ? Math.max(...steps.map(s => s.step_order)) + 10 : 10;
    const { error } = await supabase.from("hearing_flow_template_steps").insert({
      flow_template_id: templateId,
      hearing_type_id: addingType,
      step_order: maxOrder,
    });
    if (error) toast.error(error.message);
    else { invalidate(); setAddingType(""); }
  };

  const handleRemove = async (stepId: string) => {
    const { error } = await supabase.from("hearing_flow_template_steps").delete().eq("id", stepId);
    if (error) toast.error(error.message);
    else invalidate();
  };

  const handleMove = async (stepId: string, direction: "up" | "down") => {
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= steps.length) return;

    const a = steps[idx], b = steps[swapIdx];
    await Promise.all([
      supabase.from("hearing_flow_template_steps").update({ step_order: b.step_order }).eq("id", a.id),
      supabase.from("hearing_flow_template_steps").update({ step_order: a.step_order }).eq("id", b.id),
    ]);
    invalidate();
  };

  const handleToggle = async (stepId: string, field: "is_checkpoint" | "is_optional", val: boolean) => {
    const { error } = await supabase.from("hearing_flow_template_steps").update({ [field]: val }).eq("id", stepId);
    if (error) toast.error(error.message);
    else invalidate();
  };

  const handleCheckpointLabel = async (stepId: string, label: string) => {
    await supabase.from("hearing_flow_template_steps").update({ checkpoint_label: label || null }).eq("id", stepId);
    invalidate();
  };

  if (isLoading) return <div className="text-white/40 text-sm py-4">Cargando pasos...</div>;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {steps.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-2 p-3 rounded-lg bg-white/5 border border-white/10 group">
            <GripVertical className="h-4 w-4 text-white/20 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white text-sm font-medium truncate">
                  {step.hearing_type?.short_name || "Tipo desconocido"}
                </span>
                {step.is_optional && (
                  <Badge variant="outline" className="border-white/20 text-white/50 text-[10px]">Opcional</Badge>
                )}
                {step.is_checkpoint && (
                  <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]">
                    <Flag className="h-3 w-3 mr-1" /> Checkpoint
                  </Badge>
                )}
              </div>
              {step.hearing_type?.legal_basis && (
                <span className="text-white/40 text-xs">{step.hearing_type.legal_basis}</span>
              )}
              {step.is_checkpoint && (
                <Input
                  defaultValue={step.checkpoint_label || ""}
                  onBlur={e => handleCheckpointLabel(step.id, e.target.value)}
                  placeholder="Etiqueta del checkpoint..."
                  className="mt-1 h-7 text-xs bg-white/5 border-white/10 text-white"
                />
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <div className="flex items-center gap-1 mr-2">
                <Label className="text-[10px] text-white/40">Opc</Label>
                <Switch
                  checked={step.is_optional}
                  onCheckedChange={v => handleToggle(step.id, "is_optional", v)}
                  className="scale-75"
                />
                <Label className="text-[10px] text-white/40 ml-1">CP</Label>
                <Switch
                  checked={step.is_checkpoint}
                  onCheckedChange={v => handleToggle(step.id, "is_checkpoint", v)}
                  className="scale-75"
                />
              </div>
              <Button variant="ghost" size="icon" onClick={() => handleMove(step.id, "up")} disabled={idx === 0} className="h-7 w-7 text-white/30 hover:text-white">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => handleMove(step.id, "down")} disabled={idx === steps.length - 1} className="h-7 w-7 text-white/30 hover:text-white">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => handleRemove(step.id)} className="h-7 w-7 text-white/30 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {steps.length === 0 && (
          <div className="text-white/40 text-sm text-center py-6">No hay pasos. Agrega uno abajo.</div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-white/10">
        <Select value={addingType} onValueChange={setAddingType}>
          <SelectTrigger className="flex-1 bg-white/5 border-white/10 text-white text-sm">
            <SelectValue placeholder="Seleccionar tipo de audiencia..." />
          </SelectTrigger>
          <SelectContent>
            {availableTypes.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.short_name} — {t.legal_basis || t.jurisdiction}</SelectItem>
            ))}
            {availableTypes.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">Todos los tipos ya están en el flujo</div>
            )}
          </SelectContent>
        </Select>
        <Button onClick={handleAddStep} disabled={!addingType} size="sm" className="bg-cyan-500 hover:bg-cyan-600 text-black">
          <Plus className="h-4 w-4 mr-1" /> Agregar
        </Button>
      </div>
    </div>
  );
}
