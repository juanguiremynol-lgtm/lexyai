/**
 * Filings tab — history of filings the firm registered as presented for this matter,
 * plus a dialog that records a new one through the canonical RPC (mcp_register_filing).
 * A filing is never proof of receipt, admission or notification.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatCivilDate } from "@/lib/civil-date";
import {
  FILING_ACTION_KINDS, FILING_ACTION_LABELS, FILING_CHANNELS, FILING_CHANNEL_LABELS, GOV_PROCEDURE_SUBTYPES,
  type FilingActionKind, validateFilingInput,
} from "@/lib/filings/filing-constants";

interface FilingRow {
  id: string; action_kind: FilingActionKind; filed_on: string; channel: keyof typeof FILING_CHANNEL_LABELS;
  source_reference: string; external_reference: string | null; procedure_subtype: string | null;
  tribunal_type: string | null; observaciones: string | null; deadline_effect: string;
  term_calculation_status: string; origin: string; created_at: string;
}

function bogotaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

export function FilingsTab({ workItem }: { workItem: { id: string; workflow_type: string } }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    action_kind: (workItem.workflow_type === "GOV_PROCEDURE" ? "DESCARGOS" : "MEMORIAL") as FilingActionKind,
    filed_on: "", channel: "EMAIL_OFICIAL" as (typeof FILING_CHANNELS)[number], source_reference: "",
    external_reference: "", observaciones: "", procedure_subtype: "",
  });

  const { data: filings, isLoading, error } = useQuery({
    queryKey: ["work-item-filings", workItem.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_item_filings" as never)
        .select("id, action_kind, filed_on, channel, source_reference, external_reference, procedure_subtype, tribunal_type, observaciones, deadline_effect, term_calculation_status, origin, created_at")
        .eq("work_item_id", workItem.id).is("deleted_at", null)
        .order("filed_on", { ascending: false }).order("id", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FilingRow[];
    },
  });

  const register = useMutation({
    mutationFn: async () => {
      const pre = validateFilingInput({ ...form, work_item_id: workItem.id, workflow_type: workItem.workflow_type,
        procedure_subtype: form.procedure_subtype || undefined });
      if (pre) throw new Error(pre);
      const { data, error } = await supabase.rpc("mcp_register_filing" as never, {
        p_action_kind: form.action_kind, p_filed_on: form.filed_on, p_channel: form.channel,
        p_source_reference: form.source_reference, p_external_reference: form.external_reference || null,
        p_observaciones: form.observaciones || null, p_workflow_type: null,
        p_procedure_subtype: form.procedure_subtype || null, p_tribunal_type: null, p_work_item_id: workItem.id,
        p_radicado: null, p_title: null, p_client_id: null, p_demandantes: null, p_demandados: null,
        p_authority_name: null, p_related_work_item_id: null, p_origin: "APP", p_idempotency_key: crypto.randomUUID(),
      } as never);
      if (error) throw new Error(error.message);
      return data as unknown as Record<string, unknown>;
    },
    onSuccess: (r) => {
      setReceipt(r);
      qc.invalidateQueries({ queryKey: ["work-item-filings", workItem.id] });
      qc.invalidateQueries({ queryKey: ["work-item-tasks"] });
      toast.success(r.duplicate_support ? "Ya estaba registrada con el mismo soporte" : "Presentación registrada");
    },
    onError: (e: Error) => toast.error(e.message.split(":")[0].replace(/_/g, " ")),
  });

  const canSubmit = form.filed_on && form.source_reference.trim().length >= 3 && !register.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Presentaciones</CardTitle>
          <CardDescription>Escritos que la firma declara haber radicado. Presentado no significa recibido, admitido ni notificado.</CardDescription>
        </div>
        <Button size="sm" onClick={() => { setReceipt(null); setOpen(true); }} className="gap-1"><Plus className="h-4 w-4" />Registrar</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : error ? (
          <p className="text-sm text-destructive">No se pudieron cargar las presentaciones.</p>
        ) : !filings?.length ? (
          <p className="text-sm text-muted-foreground">Sin presentaciones registradas.</p>
        ) : (
          <ul className="space-y-3">
            {filings.map((f) => (
              <li key={f.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{FILING_ACTION_LABELS[f.action_kind] ?? f.action_kind}</Badge>
                  <span className="font-medium">{formatCivilDate(f.filed_on)}</span>
                  <span className="text-muted-foreground">· {FILING_CHANNEL_LABELS[f.channel] ?? f.channel}</span>
                  {f.term_calculation_status === "PENDING_LEGAL_TRIGGER_REVIEW" && (
                    <Badge variant="outline">Término: revisar evento habilitante</Badge>
                  )}
                </div>
                <p className="mt-1 break-words">{f.source_reference}</p>
                {f.external_reference && <p className="text-muted-foreground">Referencia: {f.external_reference}</p>}
                {f.procedure_subtype && <p className="text-muted-foreground">Subtipo: {f.procedure_subtype.replace(/_/g, " ").toLowerCase()}</p>}
                {f.observaciones && <p className="text-muted-foreground">{f.observaciones}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{receipt ? "Recibo de registro" : "Registrar presentación"}</DialogTitle>
            <DialogDescription>
              {receipt ? "Quedó registrado como presentado; la recepción por la autoridad no queda acreditada."
                : "Registra un escrito que ya radicaste. Andrómeda no envía nada a la autoridad."}
            </DialogDescription>
          </DialogHeader>
          {receipt ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Tipo</dt><dd>{FILING_ACTION_LABELS[receipt.tipo as FilingActionKind] ?? String(receipt.tipo)}</dd>
              <dt className="text-muted-foreground">Fecha de presentación</dt><dd>{formatCivilDate(String(receipt.fecha_presentacion))}</dd>
              <dt className="text-muted-foreground">Estado</dt><dd>Presentado, recepción no acreditada</dd>
              <dt className="text-muted-foreground">Términos</dt>
              <dd>{receipt.deadline_effect === "PENDING_TRIGGER" ? "Sin plazo: se creó una tarea para revisar el evento habilitante" : "Sin efecto en términos"}</dd>
              {receipt.duplicate_support ? <><dt className="text-muted-foreground">Nota</dt><dd>Ya existía con el mismo soporte; no se duplicó</dd></> : null}
            </dl>
          ) : (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1"><Label>Tipo</Label>
                  <Select value={form.action_kind} onValueChange={(v) => setForm({ ...form, action_kind: v as FilingActionKind })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FILING_ACTION_KINDS.filter((k) => k !== "PETICION").map((k) => <SelectItem key={k} value={k}>{FILING_ACTION_LABELS[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1"><Label>Canal</Label>
                  <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v as typeof form.channel })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{FILING_CHANNELS.map((c) => <SelectItem key={c} value={c}>{FILING_CHANNEL_LABELS[c]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1"><Label htmlFor="filed_on">Fecha de presentación</Label>
                <Input id="filed_on" type="date" max={bogotaToday()} value={form.filed_on} onChange={(e) => setForm({ ...form, filed_on: e.target.value })} />
              </div>
              <div className="grid gap-1"><Label htmlFor="src">Soporte</Label>
                <Textarea id="src" rows={2} placeholder="Ej.: correo enviado el 17/11 a la cuenta oficial del despacho; recibo de plataforma n.º…" value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} />
              </div>
              <div className="grid gap-1"><Label htmlFor="ext">Referencia externa (opcional)</Label>
                <Input id="ext" placeholder="SPOA, comparendo, radicado administrativo" value={form.external_reference} onChange={(e) => setForm({ ...form, external_reference: e.target.value })} />
              </div>
              {workItem.workflow_type === "GOV_PROCEDURE" && (
                <div className="grid gap-1"><Label>Subtipo de trámite</Label>
                  <Select value={form.procedure_subtype} onValueChange={(v) => setForm({ ...form, procedure_subtype: v })}>
                    <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>{GOV_PROCEDURE_SUBTYPES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1"><Label htmlFor="obs">Observaciones (opcional)</Label>
                <Textarea id="obs" rows={2} value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            {receipt ? <Button onClick={() => setOpen(false)}>Cerrar</Button> : (
              <Button disabled={!canSubmit} onClick={() => register.mutate()}>
                {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmo que fue radicado
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
