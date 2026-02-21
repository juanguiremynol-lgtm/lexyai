/**
 * NotificationDefendantSelector — Step for selecting which defendants
 * to notify in Notificación Personal / por Aviso flows.
 * Fetches work_item_parties and shows defendant selection with data completeness.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Mail, MapPin, Building2, User, Info } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export interface DefendantParty {
  id: string;
  name: string;
  party_type: string; // 'natural' | 'juridica'
  email: string | null;
  address: string | null;
  cedula: string | null;
  phone: string | null;
  company_name: string | null;
  company_nit: string | null;
  rep_legal_name: string | null;
  rep_legal_email: string | null;
  rep_legal_cedula: string | null;
  rep_legal_cargo: string | null;
}

export interface SelectedDefendant {
  party: DefendantParty;
  selected: boolean;
  previousNotificationDate?: string | null;
}

interface Props {
  workItemId: string;
  documentType: "notificacion_personal" | "notificacion_por_aviso";
  selectedDefendants: SelectedDefendant[];
  onSelectionChange: (defendants: SelectedDefendant[]) => void;
  autoAdmisorioDate: string;
  onAutoAdmisorioDateChange: (date: string) => void;
  autoAdmisorioInferred: boolean;
}

export function NotificationDefendantSelector({
  workItemId,
  documentType,
  selectedDefendants,
  onSelectionChange,
  autoAdmisorioDate,
  onAutoAdmisorioDateChange,
  autoAdmisorioInferred,
}: Props) {
  // Fetch defendant parties
  const { data: parties, isLoading: partiesLoading } = useQuery({
    queryKey: ["defendant-parties", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_parties")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("party_side", "demandado")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data || []) as DefendantParty[];
    },
    enabled: !!workItemId,
  });

  // Fetch previous notifications for this work item
  const { data: previousNotifs } = useQuery({
    queryKey: ["previous-notifications", workItemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, document_type, variables, status, created_at")
        .eq("work_item_id", workItemId)
        .in("document_type", ["notificacion_personal", "notificacion_por_aviso"])
        .neq("status", "draft")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!workItemId,
  });

  // Check prerequisite for aviso — warn if no personal notification exists for selected defendant
  const hasPersonalNotification = (partyId: string): string | null => {
    if (!previousNotifs) return null;
    const match = previousNotifs.find(doc => {
      if (doc.document_type !== "notificacion_personal") return false;
      const vars = doc.variables as Record<string, string> | null;
      return vars?.defendant_party_id === partyId;
    });
    return match ? match.created_at : null;
  };

  // Initialize defendants from parties when loaded
  const initializeDefendants = () => {
    if (!parties || parties.length === 0) return;
    if (selectedDefendants.length > 0) return; // already initialized

    const defaults: SelectedDefendant[] = parties.map(p => {
      const prevDate = hasPersonalNotification(p.id);
      return {
        party: p,
        selected: !prevDate, // Uncheck if already notified
        previousNotificationDate: prevDate,
      };
    });
    onSelectionChange(defaults);
  };

  // Initialize on data load
  if (parties && parties.length > 0 && selectedDefendants.length === 0) {
    initializeDefendants();
  }

  const toggleDefendant = (idx: number) => {
    const updated = [...selectedDefendants];
    updated[idx] = { ...updated[idx], selected: !updated[idx].selected };
    onSelectionChange(updated);
  };

  const selectAll = () => {
    onSelectionChange(selectedDefendants.map(d => ({ ...d, selected: true })));
  };

  const deselectAll = () => {
    onSelectionChange(selectedDefendants.map(d => ({ ...d, selected: false })));
  };

  const hasData = (val: string | null | undefined) => !!val?.trim();

  if (partiesLoading) {
    return <div className="text-sm text-muted-foreground py-4">Cargando partes...</div>;
  }

  if (!parties || parties.length === 0) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20">
        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-sm">No hay demandados registrados</p>
          <p className="text-xs text-muted-foreground mt-1">
            Agregue partes demandadas en la pestaña "Partes" del expediente antes de generar notificaciones.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Auto admisorio date */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Fecha del auto admisorio *</Label>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={autoAdmisorioDate}
            onChange={(e) => onAutoAdmisorioDateChange(e.target.value)}
            className="max-w-xs"
          />
          {autoAdmisorioInferred && (
            <Badge variant="outline" className="text-emerald-600 border-emerald-300">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Inferido de actuaciones
            </Badge>
          )}
        </div>
        {!autoAdmisorioDate && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            No se encontró la fecha del auto admisorio en las actuaciones. Ingrese la fecha manualmente.
          </p>
        )}
      </div>

      {/* Aviso prerequisite warning */}
      {documentType === "notificacion_por_aviso" && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/20">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            El Art. 292 CGP requiere que se haya agotado primero el trámite de notificación personal (Art. 291).
            Los demandados sin notificación personal previa mostrarán una advertencia.
          </p>
        </div>
      )}

      {/* Defendant selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">
            Seleccionar demandado(s) a notificar ({selectedDefendants.filter(d => d.selected).length} de {selectedDefendants.length})
          </Label>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-primary hover:underline">Seleccionar todos</button>
            <button onClick={deselectAll} className="text-xs text-muted-foreground hover:underline">Deseleccionar</button>
          </div>
        </div>

        <div className="space-y-2">
          {selectedDefendants.map((d, idx) => {
            const isJuridica = d.party.party_type === "juridica" || !!d.party.company_name;
            const contactEmail = isJuridica ? (d.party.rep_legal_email || d.party.email) : d.party.email;
            const displayName = isJuridica
              ? `${d.party.company_name || d.party.name}${d.party.rep_legal_name ? ` (Rep. Legal: ${d.party.rep_legal_name})` : ""}`
              : d.party.name;

            const dataComplete = hasData(contactEmail) && hasData(d.party.address);
            const missingPrevNotif = documentType === "notificacion_por_aviso" && !d.previousNotificationDate;

            return (
              <Card key={d.party.id} className={`transition-all ${d.selected ? "ring-1 ring-primary/30" : "opacity-70"}`}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={d.selected}
                      onCheckedChange={() => toggleDefendant(idx)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        {isJuridica ? <Building2 className="h-4 w-4 text-muted-foreground shrink-0" /> : <User className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <span className="font-medium text-sm truncate">{displayName}</span>
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {contactEmail ? (
                          <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{contactEmail}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600"><AlertCircle className="h-3 w-3" />Sin email</span>
                        )}
                        {d.party.address ? (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{d.party.address}</span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600"><AlertCircle className="h-3 w-3" />Sin dirección</span>
                        )}
                      </div>

                      {/* Status badges */}
                      <div className="flex gap-2 flex-wrap">
                        {dataComplete ? (
                          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Datos completos
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                            <AlertCircle className="h-2.5 w-2.5 mr-1" /> Datos incompletos
                          </Badge>
                        )}

                        {d.previousNotificationDate && (
                          <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">
                            <Mail className="h-2.5 w-2.5 mr-1" />
                            Notificación Personal — {format(new Date(d.previousNotificationDate), "d MMM yyyy", { locale: es })}
                          </Badge>
                        )}

                        {missingPrevNotif && d.selected && (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                            <AlertCircle className="h-2.5 w-2.5 mr-1" /> Sin notificación personal previa
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Aviso warning if some selected defendants lack personal notification */}
      {documentType === "notificacion_por_aviso" && selectedDefendants.some(d => d.selected && !d.previousNotificationDate) && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              No se encontró Notificación Personal previa para algunos demandados seleccionados.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              El Art. 292 del CGP requiere que se haya agotado primero el trámite de notificación personal.
              ¿Desea continuar de todas formas? (La notificación pudo haberse realizado fuera de ATENIA.)
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Info className="h-3 w-3" />
        Se generará un documento individual para cada demandado seleccionado.
      </p>
    </div>
  );
}
