/**
 * PartyManager — Full party management UI with side grouping, completeness warnings.
 * Used in work item detail Partes tab.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Users, Plus, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { PartyCard } from "./PartyCard";
import { AddEditPartyModal } from "./AddEditPartyModal";
import {
  type WorkItemParty,
  type PartyFormData,
  type PartySide,
  getSideLabels,
  calculateOverallCompleteness,
} from "@/lib/party-utils";

interface PartyManagerProps {
  workItemId: string;
  workflowType: string;
  ownerId: string;
  organizationId?: string | null;
}

export function PartyManager({ workItemId, workflowType, ownerId, organizationId }: PartyManagerProps) {
  const queryClient = useQueryClient();
  const [editingParty, setEditingParty] = useState<WorkItemParty | null>(null);
  const [addingSide, setAddingSide] = useState<PartySide | null>(null);
  const [saving, setSaving] = useState(false);
  const [tercerosOpen, setTercerosOpen] = useState(false);

  const sideLabels = getSideLabels(workflowType);

  // Fetch parties
  const { data: parties = [], isLoading } = useQuery({
    queryKey: ["work-item-parties", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_parties")
        .select("*")
        .eq("work_item_id", workItemId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as WorkItemParty[];
    },
  });

  // Group by side
  const grouped = useMemo(() => {
    const demandantes = parties.filter((p) => p.party_side === "demandante");
    const demandados = parties.filter((p) => p.party_side === "demandado");
    const terceros = parties.filter((p) => p.party_side === "tercero" || p.party_side === "otro");
    return { demandantes, demandados, terceros };
  }, [parties]);

  // Completeness
  const completeness = useMemo(() => calculateOverallCompleteness(parties), [parties]);
  const warnMissing = completeness.totalMissing.filter((m) => m.severity === "warn");

  // Save party mutation
  const saveMutation = useMutation({
    mutationFn: async ({ data, partyId }: { data: PartyFormData; partyId?: string }) => {
      const payload: any = {
        work_item_id: workItemId,
        owner_id: ownerId,
        organization_id: organizationId || null,
        party_type: data.party_type,
        party_side: data.party_side,
        is_our_client: data.is_our_client,
        name: data.name,
        cedula: data.cedula || null,
        cedula_city: data.cedula_city || null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        company_name: data.company_name || null,
        company_nit: data.company_nit || null,
        company_city: data.company_city || null,
        rep_legal_name: data.rep_legal_name || null,
        rep_legal_cedula: data.rep_legal_cedula || null,
        rep_legal_cedula_city: data.rep_legal_cedula_city || null,
        rep_legal_cargo: data.rep_legal_cargo || null,
        rep_legal_email: data.rep_legal_email || null,
        rep_legal_phone: data.rep_legal_phone || null,
      };

      if (partyId) {
        const { error } = await supabase
          .from("work_item_parties")
          .update(payload)
          .eq("id", partyId);
        if (error) throw error;
      } else {
        payload.display_order = parties.length;
        const { error } = await supabase
          .from("work_item_parties")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Parte guardada");
      queryClient.invalidateQueries({ queryKey: ["work-item-parties", workItemId] });
      setEditingParty(null);
      setAddingSide(null);
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (partyId: string) => {
      const { error } = await supabase.from("work_item_parties").delete().eq("id", partyId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parte eliminada");
      queryClient.invalidateQueries({ queryKey: ["work-item-parties", workItemId] });
    },
    onError: (err: Error) => {
      toast.error("Error: " + err.message);
    },
  });

  const handleSave = useCallback(
    (data: PartyFormData) => {
      setSaving(true);
      saveMutation.mutate(
        { data, partyId: editingParty?.id },
        { onSettled: () => setSaving(false) }
      );
    },
    [editingParty, saveMutation]
  );

  const handleDelete = (partyId: string) => {
    if (window.confirm("¿Eliminar esta parte?")) {
      deleteMutation.mutate(partyId);
    }
  };

  // Check for conflict of interest
  const hasConflict = useMemo(() => {
    const clientSides = new Set(parties.filter((p) => p.is_our_client).map((p) => p.party_side));
    return clientSides.has("demandante") && clientSides.has("demandado");
  }, [parties]);

  const noClientWarning = useMemo(() => {
    return parties.length > 0 && !parties.some((p) => p.is_our_client);
  }, [parties]);

  const renderSideSection = (label: string, sideParties: WorkItemParty[], side: PartySide) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {label} ({sideParties.length})
        </h4>
      </div>

      {sideParties.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">Sin partes registradas</p>
      ) : (
        <div className="space-y-2">
          {sideParties.map((p) => (
            <PartyCard
              key={p.id}
              party={p}
              onEdit={() => setEditingParty(p)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setAddingSide(side)}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Agregar {label.toLowerCase().replace(/parte\s*/i, "")}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Completeness Banner */}
      {parties.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                📊 Datos de partes: {completeness.score}% completo
              </span>
              {warnMissing.length > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-500/50 text-xs">
                  {warnMissing.length} pendiente{warnMissing.length > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <Progress value={completeness.score} className="h-2" />
            {warnMissing.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-xs text-muted-foreground">
                  Campos pendientes que afectarán la generación automática de documentos:
                </p>
                <ul className="text-xs space-y-0.5">
                  {warnMissing.slice(0, 4).map((m, i) => (
                    <li key={i} className="flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {m.partyName}: falta {m.label.toLowerCase()}
                    </li>
                  ))}
                  {warnMissing.length > 4 && (
                    <li className="text-amber-600 text-xs">+{warnMissing.length - 4} más</li>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Conflict of interest warning */}
      {hasConflict && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Está marcando partes en lados opuestos como su cliente. Verifique que no exista conflicto de intereses.
        </div>
      )}

      {/* No client warning */}
      {noClientWarning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          No ha indicado cuál es su cliente. Marque al menos una parte para facilitar la generación de documentos.
        </div>
      )}

      {/* Side A */}
      {renderSideSection(sideLabels.sideA, grouped.demandantes, "demandante")}

      {/* Side B */}
      {renderSideSection(sideLabels.sideB, grouped.demandados, "demandado")}

      {/* Terceros (collapsible) */}
      <Collapsible open={tercerosOpen || grouped.terceros.length > 0} onOpenChange={setTercerosOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 text-sm font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full">
            {tercerosOpen || grouped.terceros.length > 0 ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Terceros / Otros ({grouped.terceros.length})
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          {renderSideSection("Tercero", grouped.terceros, "tercero")}
        </CollapsibleContent>
      </Collapsible>

      {/* Empty state */}
      {parties.length === 0 && !isLoading && (
        <div className="text-center py-8 space-y-3">
          <Users className="h-10 w-10 text-muted-foreground mx-auto" />
          <div>
            <p className="text-sm text-muted-foreground">No hay partes registradas.</p>
            <p className="text-xs text-muted-foreground">
              Agregue las partes del proceso para facilitar la generación automática de documentos.
            </p>
          </div>
          <div className="flex gap-2 justify-center">
            <Button size="sm" variant="outline" onClick={() => setAddingSide("demandante")}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {sideLabels.sideA}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddingSide("demandado")}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {sideLabels.sideB}
            </Button>
          </div>
        </div>
      )}

      {/* Tip */}
      {parties.length === 0 && !isLoading && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-muted-foreground">
          💡 <strong>Consejo:</strong> Agregue los datos completos de las partes ahora (cédula, email, teléfono). Esto permitirá generar poderes y contratos automáticamente más adelante.
        </div>
      )}

      {/* Add Modal */}
      <AddEditPartyModal
        open={addingSide !== null}
        onClose={() => setAddingSide(null)}
        onSave={handleSave}
        side={addingSide || "demandante"}
        sideLabel={
          addingSide === "demandante" ? sideLabels.sideA :
          addingSide === "demandado" ? sideLabels.sideB : "Tercero"
        }
        saving={saving}
      />

      {/* Edit Modal */}
      <AddEditPartyModal
        open={editingParty !== null}
        onClose={() => setEditingParty(null)}
        onSave={handleSave}
        party={editingParty}
        side={editingParty?.party_side || "demandante"}
        sideLabel={
          editingParty?.party_side === "demandante" ? sideLabels.sideA :
          editingParty?.party_side === "demandado" ? sideLabels.sideB : "Tercero"
        }
        saving={saving}
      />
    </div>
  );
}
