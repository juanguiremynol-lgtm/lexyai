/**
 * Manual record and email follow-up for administrative matters
 * (PETICION / GOV_PROCEDURE). Outlook stays the source of message content:
 * only metadata is shown and stored.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Search, Link2, ExternalLink } from "lucide-react";
import {
  PETICION_SUBTYPES, MANUAL_EVENT_CODES, EVENT_LABELS,
  validatePeticionState, buildPeticionStatePayload, type PeticionStateForm,
} from "@/lib/peticion-admin";

interface Props {
  workItem: { id: string; owner_id: string; organization_id: string | null; workflow_type: string; authority_name?: string | null; authority_email?: string | null };
}

const todayBogota = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function PeticionAdminPanel({ workItem }: Props) {
  const isPeticion = workItem.workflow_type === "PETICION";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seguimiento administrativo</CardTitle>
        <CardDescription>
          Registro manual de la petición y correos de Outlook. El envío no prueba la recepción ni inicia términos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPeticion && <StateForm workItem={workItem} />}
        {isPeticion && <EventsLog workItem={workItem} />}
        <OutlookSearch workItemId={workItem.id} />
      </CardContent>
    </Card>
  );
}

function StateForm({ workItem }: Props) {
  const qc = useQueryClient();
  const { data: state, isLoading } = useQuery({
    queryKey: ["peticion-state", workItem.id],
    queryFn: async () => {
      const { data, error } = await db.from("peticion_work_item_state").select("*").eq("work_item_id", workItem.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const empty: PeticionStateForm = {
    subtype_code: "GENERAL", authority_name: workItem.authority_name ?? "",
    authority_email_domain: (workItem.authority_email ?? "").split("@")[1] ?? "",
    sent_at: "", authority_received_at: "", authority_radicado: "", anchor_provenance_note: "",
  };
  const [form, setForm] = useState<PeticionStateForm>(empty);
  useEffect(() => {
    if (state) setForm({
      subtype_code: state.subtype_code ?? "GENERAL", authority_name: state.authority_name ?? "",
      authority_email_domain: state.authority_email_domain ?? "", sent_at: state.sent_at ?? "",
      authority_received_at: state.authority_received_at ?? "", authority_radicado: state.authority_radicado ?? "",
      anchor_provenance_note: state.anchor_provenance_note ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const save = useMutation({
    mutationFn: async () => {
      const errors = validatePeticionState(form, todayBogota());
      if (errors.length) throw new Error(errors.join(" "));
      const payload = buildPeticionStatePayload(form, {
        work_item_id: workItem.id, owner_id: workItem.owner_id, organization_id: workItem.organization_id,
      });
      const { error } = await db.from("peticion_work_item_state").upsert(payload, { onConflict: "work_item_id" });
      if (error) throw error;
      await db.from("peticion_events").insert({
        work_item_id: workItem.id, organization_id: workItem.organization_id, owner_id: workItem.owner_id,
        event_code: "REGISTRO_ACTUALIZADO", event_date: todayBogota(), source: "USER",
        notes: "Datos de la petición actualizados manualmente.",
        metadata: { before: state ?? null, after: payload },
      });
    },
    onSuccess: () => {
      toast.success("Datos de la petición guardados");
      void qc.invalidateQueries({ queryKey: ["peticion-state", workItem.id] });
      void qc.invalidateQueries({ queryKey: ["peticion-events", workItem.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return null;
  const set = (k: keyof PeticionStateForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Tipo de petición</Label>
          <Select value={form.subtype_code} onValueChange={(v) => setForm((f) => ({ ...f, subtype_code: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PETICION_SUBTYPES.map((s) => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Radicado oficial de la autoridad</Label><Input value={form.authority_radicado} onChange={set("authority_radicado")} placeholder="Pendiente" /></div>
        <div className="space-y-1"><Label>Autoridad</Label><Input value={form.authority_name} onChange={set("authority_name")} /></div>
        <div className="space-y-1"><Label>Dominio de correo de la autoridad</Label><Input value={form.authority_email_domain} onChange={set("authority_email_domain")} /></div>
        <div className="space-y-1"><Label>Fecha de envío</Label><Input type="date" value={form.sent_at} onChange={set("sent_at")} /></div>
        <div className="space-y-1"><Label>Fecha probada de recepción</Label><Input type="date" value={form.authority_received_at} onChange={set("authority_received_at")} /></div>
      </div>
      {form.authority_received_at && (
        <div className="space-y-1"><Label>Prueba de la recepción</Label><Textarea value={form.anchor_provenance_note} onChange={set("anchor_provenance_note")} placeholder="Acuse, radicado o constancia" /></div>
      )}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>Guardar datos</Button>
    </div>
  );
}

function EventsLog({ workItem }: Props) {
  const qc = useQueryClient();
  const { data: events = [] } = useQuery({
    queryKey: ["peticion-events", workItem.id],
    queryFn: async () => {
      const { data, error } = await db.from("peticion_events").select("id, event_code, event_date, source, notes, metadata, created_at")
        .eq("work_item_id", workItem.id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const [code, setCode] = useState("NOTA");
  const [date, setDate] = useState(todayBogota());
  const [notes, setNotes] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      if (!date || date > todayBogota()) throw new Error("Fecha inválida.");
      const { error } = await db.from("peticion_events").insert({
        work_item_id: workItem.id, organization_id: workItem.organization_id, owner_id: workItem.owner_id,
        event_code: code, event_date: date, source: "USER", notes: notes.trim().slice(0, 2000) || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setNotes(""); toast.success("Novedad registrada"); void qc.invalidateQueries({ queryKey: ["peticion-events", workItem.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <h4 className="font-medium">Novedades</h4>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Select value={code} onValueChange={setCode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{MANUAL_EVENT_CODES.map((e) => <SelectItem key={e.code} value={e.code}>{e.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas o referencia de la evidencia" />
      <Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending}>Registrar novedad</Button>
      <ul className="divide-y rounded-md border">
        {events.length === 0 && <li className="p-3 text-sm text-muted-foreground">Sin novedades.</li>}
        {events.map((e: { id: string; event_code: string; event_date: string | null; source: string; notes: string | null; metadata: Record<string, unknown> | null }) => (
          <li key={e.id} className="space-y-1 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{EVENT_LABELS[e.event_code] ?? e.event_code}</span>
              <Badge variant="outline">{e.source === "EMAIL_EVIDENCE" ? "Correo" : e.source === "USER" ? "Manual" : "Sistema"}</Badge>
              {e.metadata?.requires_human_review === true && <Badge variant="secondary">Por revisar</Badge>}
              <span className="text-muted-foreground">{e.event_date}</span>
            </div>
            {e.metadata?.subject && <p className="text-muted-foreground">{String(e.metadata.subject)}</p>}
            {e.metadata?.proposed_official_id && <p>Radicado mencionado: <b>{String(e.metadata.proposed_official_id)}</b> (confírmelo en los datos de la petición)</p>}
            {e.notes && <p className="text-muted-foreground">{e.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FoundMessage { id: string; subject: string | null; from: string | null; to: string[]; at: string | null; web_link: string | null; link_status: string | null }

function OutlookSearch({ workItemId }: { workItemId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<"sentitems" | "inbox">("sentitems");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundMessage[]>([]);
  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("outlook-message-link", { body: { work_item_id: workItemId, ...body } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      throw new Error(ctx ? (await ctx.json().catch(() => ({})))?.error ?? error.message : error.message);
    }
    return data;
  };
  const search = useMutation({
    mutationFn: () => call({ action: "search", folder, query: query.trim() || undefined }),
    onSuccess: (d) => setResults(d.messages ?? []),
    onError: (e: Error) => toast.error(e.message),
  });
  const link = useMutation({
    mutationFn: (id: string) => call({ action: "link", message_id: id }),
    onSuccess: (_d, id) => {
      toast.success("Correo vinculado al asunto");
      setResults((r) => r.map((m) => (m.id === id ? { ...m, link_status: "CONFIRMED" } : m)));
      void qc.invalidateQueries({ queryKey: ["work-item-email-links"] });
      void qc.invalidateQueries({ queryKey: ["peticion-events", workItemId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary" className="gap-2"><Search className="h-4 w-4" />Buscar correo en Outlook</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Vincular correo de Outlook</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Sin texto, se buscan los correos con el buzón de la autoridad. Solo usted decide qué correo se vincula.</p>
        <div className="flex flex-wrap gap-2">
          <Select value={folder} onValueChange={(v) => setFolder(v as "sentitems" | "inbox")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="sentitems">Enviados</SelectItem><SelectItem value="inbox">Recibidos</SelectItem></SelectContent>
          </Select>
          <Input className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Asunto o palabra clave" maxLength={120} />
          <Button onClick={() => search.mutate()} disabled={search.isPending}>Buscar</Button>
        </div>
        <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
          {results.length === 0 && <li className="p-3 text-sm text-muted-foreground">Sin resultados.</li>}
          {results.map((m) => (
            <li key={m.id} className="flex items-start gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{m.subject || "(sin asunto)"}</p>
                <p className="text-muted-foreground">{m.from} → {m.to.join(", ")} · {m.at ? new Date(m.at).toLocaleString("es-CO") : ""}</p>
              </div>
              {m.web_link && <a href={m.web_link} target="_blank" rel="noreferrer" aria-label="Abrir en Outlook"><ExternalLink className="h-4 w-4" /></a>}
              {m.link_status === "CONFIRMED"
                ? <Badge>Vinculado</Badge>
                : <Button size="sm" variant="outline" className="gap-1" onClick={() => link.mutate(m.id)} disabled={link.isPending}><Link2 className="h-3 w-3" />Vincular</Button>}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
