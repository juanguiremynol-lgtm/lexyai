/**
 * FlowTemplatesManager — CRUD for hearing flow templates + step editor
 */
import { useState } from "react";
import { useHearingFlowTemplates, JURISDICTION_LABELS, type HearingFlowTemplate } from "@/hooks/use-hearing-catalog";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Plus, ChevronDown, ChevronRight, ListOrdered } from "lucide-react";
import { FlowStepsEditor } from "./FlowStepsEditor";

export function FlowTemplatesManager() {
  const { data: templates = [], isLoading } = useHearingFlowTemplates();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({ jurisdiction: "", process_subtype: "", name: "", description: "", is_default: false });
  const [saving, setSaving] = useState(false);

  // Group by jurisdiction
  const grouped = templates.reduce<Record<string, HearingFlowTemplate[]>>((acc, t) => {
    (acc[t.jurisdiction] ||= []).push(t);
    return acc;
  }, {});

  const handleCreate = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("hearing_flow_templates").insert({
        jurisdiction: newTemplate.jurisdiction,
        process_subtype: newTemplate.process_subtype || null,
        name: newTemplate.name,
        description: newTemplate.description || null,
        is_default: newTemplate.is_default,
      });
      if (error) throw error;
      toast.success("Plantilla creada");
      queryClient.invalidateQueries({ queryKey: ["hearing-flow-templates"] });
      setShowCreate(false);
      setNewTemplate({ jurisdiction: "", process_subtype: "", name: "", description: "", is_default: false });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/50 text-sm">Plantillas de flujo de audiencias por jurisdicción</p>
        <Button onClick={() => setShowCreate(true)} className="bg-cyan-500 hover:bg-cyan-600 text-black">
          <Plus className="h-4 w-4 mr-1" /> Nueva plantilla
        </Button>
      </div>

      {isLoading ? (
        <div className="text-white/40 text-center py-8">Cargando plantillas...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-white/40 text-center py-8">No hay plantillas de flujo</div>
      ) : (
        Object.entries(grouped).map(([jurisdiction, tpls]) => (
          <div key={jurisdiction} className="space-y-2">
            <h3 className="text-white/60 font-mono text-xs uppercase tracking-wider">
              {JURISDICTION_LABELS[jurisdiction] || jurisdiction}
            </h3>
            {tpls.map(tpl => (
              <Collapsible
                key={tpl.id}
                open={expandedId === tpl.id}
                onOpenChange={o => setExpandedId(o ? tpl.id : null)}
              >
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/8 transition-colors text-left">
                    {expandedId === tpl.id ? (
                      <ChevronDown className="h-4 w-4 text-white/40 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-white/40 shrink-0" />
                    )}
                    <ListOrdered className="h-4 w-4 text-cyan-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium">{tpl.name}</span>
                      {tpl.description && (
                        <p className="text-white/40 text-xs truncate">{tpl.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {tpl.is_default && (
                        <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px]">Default</Badge>
                      )}
                      <Badge variant="outline" className="border-white/20 text-white/50 text-[10px]">v{tpl.version}</Badge>
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6 pt-2">
                  <FlowStepsEditor templateId={tpl.id} jurisdiction={tpl.jurisdiction} />
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        ))
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-black border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Nueva plantilla de flujo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-white/70">Jurisdicción *</Label>
                <Select value={newTemplate.jurisdiction} onValueChange={v => setNewTemplate(p => ({ ...p, jurisdiction: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(JURISDICTION_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white/70">Subtipo</Label>
                <Input
                  value={newTemplate.process_subtype}
                  onChange={e => setNewTemplate(p => ({ ...p, process_subtype: e.target.value }))}
                  placeholder="ej: declarativo"
                  className="bg-white/5 border-white/10 text-white"
                />
              </div>
            </div>
            <div>
              <Label className="text-white/70">Nombre *</Label>
              <Input
                value={newTemplate.name}
                onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))}
                placeholder="Proceso Declarativo CGP (Estándar)"
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <div>
              <Label className="text-white/70">Descripción</Label>
              <Textarea
                value={newTemplate.description}
                onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))}
                rows={2}
                className="bg-white/5 border-white/10 text-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newTemplate.is_default} onCheckedChange={v => setNewTemplate(p => ({ ...p, is_default: v }))} />
              <Label className="text-white/70">Plantilla por defecto</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving || !newTemplate.jurisdiction || !newTemplate.name} className="bg-cyan-500 hover:bg-cyan-600 text-black">
              {saving ? "Creando..." : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
