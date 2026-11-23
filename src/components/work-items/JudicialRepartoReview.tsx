import { useEffect, useId, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { deriveFromRadicado } from "@/lib/radicado-derivation";
import { WORKFLOW_TYPES } from "@/lib/workflow-constants";
import { toast } from "sonner";
import {
  downloadRepartoPdf, normalizeIntakeRadicado, repartoSuggestions, REPARTO_LABELS, REPARTO_WORKFLOWS,
  type RepartoConfirmArgs, type RepartoDraft, type RepartoField, type RepartoKind,
} from "@/lib/judicial-reparto";

const LABELS: Record<RepartoField, string> = {
  kind: "tipo de comprobante",
  radicado: "radicado",
  external_reference: "referencia de solicitud",
  authority_name: "despacho",
  demandantes: "demandantes o accionantes",
  demandados: "demandados o accionados",
  receipt_on: "fecha de recepción",
  assigned_on: "fecha de reparto",
};

interface Props {
  draft: RepartoDraft;
  userId: string;
  existingWorkItemId?: string;
  onBack: () => void;
  onBusy: (busy: boolean) => void;
  onSaved: (id: string, created: boolean) => void;
}

export function JudicialRepartoReview({ draft, userId, existingWorkItemId, onBack, onBusy, onSaved }: Props) {
  const prefix = useId();
  const suggestions = repartoSuggestions(draft);
  const proposed = (field: RepartoField) => suggestions.fields?.[field]?.value ?? "";
  const [kind, setKind] = useState(proposed("kind") as RepartoKind | "");
  const [radicado, setRadicado] = useState(proposed("radicado"));
  const [reference, setReference] = useState(proposed("external_reference"));
  const [authority, setAuthority] = useState(proposed("authority_name"));
  const [receiptDate, setReceiptDate] = useState(proposed("receipt_on"));
  const [assignmentDate, setAssignmentDate] = useState(proposed("assigned_on"));
  const [demandantes, setDemandantes] = useState(proposed("demandantes"));
  const [demandados, setDemandados] = useState(proposed("demandados"));
  const [title, setTitle] = useState(() =>
    [proposed("demandantes"), proposed("demandados")].filter(Boolean).join(" contra ").slice(0, 180)
  );
  const [workflow, setWorkflow] = useState(() => {
    const derived = deriveFromRadicado(proposed("radicado"));
    return derived?.workflowConfidence === "high" && REPARTO_WORKFLOWS.some((type) => type === derived.workflow)
      ? derived.workflow ?? "" : "";
  });
  const [clientId, setClientId] = useState("");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const digits = normalizeIntakeRadicado(radicado);
  const invalidRadicado = Boolean(radicado.trim()) && !digits;
  const normalizedReference = reference.trim().toUpperCase();
  const [lookup, setLookup] = useState({ digits, reference: normalizedReference });
  const lookupCurrent = lookup.digits === digits && lookup.reference === normalizedReference;
  useEffect(() => {
    const timer = window.setTimeout(() => setLookup({ digits, reference: normalizedReference }), 300);
    return () => window.clearTimeout(timer);
  }, [digits, normalizedReference]);

  const matches = useQuery({
    queryKey: ["judicial-reparto-matches", userId, lookup.digits, lookup.reference],
    enabled: !existingWorkItemId && Boolean(lookup.digits || lookup.reference),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("find_judicial_reparto_matches", {
        p_radicado: lookup.digits,
        p_reference: lookup.reference || null,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const checking = !existingWorkItemId && (!lookupCurrent || matches.isFetching);
  const matchesFailed = !existingWorkItemId && Boolean(digits || normalizedReference) && matches.isError;
  const matchingItems = existingWorkItemId || !lookupCurrent ? [] : matches.data ?? [];
  const targetId = existingWorkItemId || matchingItems.find((item) => item.id === selectedMatch &&
    item.lifecycle_state === "ACTIVE" && !["PETICION", "GOV_PROCEDURE"].includes(item.workflow_type))?.id || null;
  const canCreate = !existingWorkItemId && !matchingItems.length && !checking && !matchesFailed;

  const { data: clients = [] } = useQuery({
    queryKey: ["judicial-reparto-clients", userId],
    enabled: canCreate,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id,name")
        .eq("owner_id", userId).is("deleted_at", null).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const save = useMutation({
    mutationFn: async (args: RepartoConfirmArgs) => {
      const { data, error } = await supabase.rpc("confirm_judicial_reparto", args);
      if (error) throw new Error(error.message);
      if (!data || typeof data !== "object" || !("work_item_id" in data) ||
        typeof data.work_item_id !== "string") throw new Error("No se pudo confirmar el vínculo con el expediente.");
      return { id: data.work_item_id, created: data.created === true };
    },
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: ({ id, created }) => onSaved(id, created),
    onError: () => {
      if (!existingWorkItemId && (digits || normalizedReference)) void matches.refetch();
    },
  });

  const ready = confirmed && Boolean(kind) && !invalidRadicado && !checking && !matchesFailed &&
    Boolean(targetId || (canCreate && workflow && title.trim()));
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || save.isPending) return;
    save.mutate({
      p_import_id: draft.id,
      p_work_item_id: targetId,
      p_confirmed: confirmed,
      p_kind: kind,
      p_reference: normalizedReference || null,
      p_radicado: digits,
      p_authority: authority.trim() || null,
      p_event_on: (kind === "REPARTO" ? assignmentDate : receiptDate) || null,
      p_workflow_type: targetId ? null : workflow,
      p_title: targetId ? null : title.trim(),
      p_client_id: targetId ? null : clientId || null,
      p_demandantes: demandantes.trim() || null,
      p_demandados: demandados.trim() || null,
    });
  };

  function field(
    key: Exclude<RepartoField, "kind">, label: string, value: string,
    change: (value: string) => void, maxLength?: number, type: "text" | "date" = "text",
  ) {
    const suggestion = suggestions.fields?.[key];
    return (
      <div className="space-y-1">
        <Label htmlFor={prefix + key}>{label}</Label>
        <Input id={prefix + key} value={value} onChange={(e) => change(e.target.value)} type={type} maxLength={maxLength} />
        {suggestion?.value === value && (
          <p className="text-xs text-muted-foreground">{suggestion.source === "PDF" ? "Leído en el PDF" : "Leído en el correo"}</p>
        )}
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-md border p-3 text-sm">
        <p className="break-words font-medium">{draft.pdf_name || draft.message_subject || "Comprobante importado"}</p>
        {draft.message_sender && <p className="break-all text-muted-foreground">{draft.message_sender}</p>}
        <div className="flex flex-wrap gap-3">
          {draft.message_url && (
            <a className="text-primary underline" href={draft.message_url} target="_blank" rel="noopener noreferrer">Ver correo original</a>
          )}
          {draft.pdf_path && (
            <button type="button" className="text-primary underline" onClick={() => {
              if (draft.pdf_path) void downloadRepartoPdf(draft.pdf_path, draft.pdf_name).catch((error: Error) => toast.error(error.message));
            }}>Descargar PDF original</button>
          )}
        </div>
        {draft.pdf_path && !suggestions.pdf_text_read && (
          <p className="text-muted-foreground">El PDF no tiene texto legible para la importación. Revisa el original y completa los campos.</p>
        )}
        {!!suggestions.conflicts?.length && (
          <p className="text-destructive" role="status">
            Encontramos valores distintos para {suggestions.conflicts.map((key) => LABELS[key]).join(", ")}. Verifica esos campos en el comprobante.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={prefix + "kind"}>Tipo de comprobante</Label>
          <Select value={kind} onValueChange={(value: RepartoKind) => setKind(value)}>
            <SelectTrigger id={prefix + "kind"}><SelectValue placeholder="Seleccionar" /></SelectTrigger>
            <SelectContent>
              {Object.entries(REPARTO_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {field("external_reference", "Referencia de la solicitud", reference, setReference, 120)}
        {field("radicado", "Radicado judicial (23 dígitos)", radicado, setRadicado, 40)}
        {field("authority_name", "Despacho asignado", authority, setAuthority, 240)}
        {kind === "RECEPCION" && field("receipt_on", "Fecha de recepción", receiptDate, setReceiptDate, undefined, "date")}
        {kind === "REPARTO" && field("assigned_on", "Fecha de reparto", assignmentDate, setAssignmentDate, undefined, "date")}
      </div>
      {invalidRadicado && <p className="text-sm text-destructive" role="alert">Usa el radicado judicial de 23 dígitos. Los números de solicitud van en su propio campo.</p>}
      {!radicado.trim() && !targetId && (
        <p className="text-sm text-muted-foreground">El expediente quedará pendiente de radicado para iniciar la vigilancia.</p>
      )}

      {checking && <p className="text-sm text-muted-foreground" role="status">Buscando coincidencias en tu cartera…</p>}
      {matchesFailed && (
        <p className="text-sm text-destructive" role="alert">
          No se pudo consultar tu cartera.{" "}
          <button type="button" onClick={() => void matches.refetch()} className="underline">Reintentar</button>
        </p>
      )}
      {!!matchingItems.length && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Expedientes que coinciden</p>
          <RadioGroup value={targetId ?? ""} onValueChange={setSelectedMatch} aria-label="Expediente existente">
            {matchingItems.map((item) => {
              const eligible = item.lifecycle_state === "ACTIVE" && !["PETICION", "GOV_PROCEDURE"].includes(item.workflow_type);
              return (
                <div key={item.id} className="flex items-start gap-2">
                  <RadioGroupItem id={prefix + item.id} value={item.id} disabled={!eligible} />
                  <Label htmlFor={prefix + item.id} className="leading-normal">
                    {item.title || item.radicado || "Expediente sin título"}
                    <span className="block text-xs text-muted-foreground">
                      {item.matched_by === "RADICADO" ? "Coincide por radicado" : "Coincide por referencia"}
                      {item.lifecycle_state === "DELETED" ? " · En papelera" : !eligible ? " · No disponible para vincular" : ""}
                    </span>
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>
      )}
      {canCreate && (
        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={prefix + "title"}>Nombre del expediente</Label>
            <Input id={prefix + "title"} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={prefix + "workflow"}>Tipo de proceso</Label>
            <Select value={workflow} onValueChange={setWorkflow}>
              <SelectTrigger id={prefix + "workflow"}><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                {REPARTO_WORKFLOWS.map((type) => <SelectItem key={type} value={type}>{WORKFLOW_TYPES[type].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!!clients.length && (
            <div className="space-y-1">
              <Label htmlFor={prefix + "client"}>Cliente (opcional)</Label>
              <Select value={clientId || "none"} onValueChange={(value) => setClientId(value === "none" ? "" : value)}>
                <SelectTrigger id={prefix + "client"}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cliente</SelectItem>
                  {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {field("demandantes", "Demandantes o accionantes", demandantes, setDemandantes, 500)}
          {field("demandados", "Demandados o accionados", demandados, setDemandados, 500)}
        </div>
      )}

      <div className="flex items-start gap-2">
        <Checkbox id={prefix + "verified"} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
        <Label htmlFor={prefix + "verified"} className="leading-normal">
          Revisé el comprobante oficial y confirmo que los datos corresponden a este expediente.
        </Label>
      </div>
      {save.error && <p className="text-sm text-destructive" role="alert">{save.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={save.isPending}>Volver</Button>
        <Button type="submit" disabled={!ready || save.isPending}>
          {save.isPending ? "Guardando…" : targetId ? "Vincular comprobante" : "Crear expediente"}
        </Button>
      </div>
    </form>
  );
}
