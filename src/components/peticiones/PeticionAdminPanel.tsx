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
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  MANUAL_EVENT_CODES, EVENT_LABELS, PETICION_COMPONENTS, PRESENTATION_SOURCES, EXTENSION_VALIDITY_LABELS,
  validatePresentation, buildPresentationRpcArgs, validateAuthority, buildAuthorityPayload, friendlyRpcError,
  type PresentationForm, type CurrentAnchor, type AuthorityForm as AuthorityFormData,
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
          Plazos desde la presentación documentada, novedades y correos de Outlook. Solo se guardan datos del correo, no su contenido.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isPeticion && <PresentationSection workItem={workItem} />}
        {isPeticion && <AuthorityForm workItem={workItem} />}
        {isPeticion && <EventsLog workItem={workItem} />}
        <OutlookSearch workItemId={workItem.id} />
      </CardContent>
    </Card>
  );
}

interface DeadlineRow {
  deadline_id: string; component: string | null; status: string; deadline_status: string | null;
  deadline_date: string | null; days: number | null; trigger_event: string; trigger_date: string;
  extension_validity: string | null; closure_reason: string | null; supersedes: string | null;
  audit: { first_business_day?: string; holidays_excluded?: string[]; tutela_review_date?: string; presented_on?: string } | null;
}

const fmt = (d?: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const componentLabel = (c: string | null) => PETICION_COMPONENTS.find((p) => p.code === c)?.label ?? c ?? "—";

function PresentationSection({ workItem }: Props) {
  const qc = useQueryClient();
  const { data: state, isLoading } = useQuery({
    queryKey: ["peticion-state", workItem.id],
    queryFn: async () => {
      const { data, error } = await db.from("peticion_work_item_state").select("*").eq("work_item_id", workItem.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const { data: terms = [] } = useQuery({
    queryKey: ["peticion-terms", workItem.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("peticion_terms_summary", { p_work_item_id: workItem.id });
      if (error) throw error;
      return (data ?? []) as DeadlineRow[];
    },
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ["co-holidays-near", state?.sent_at],
    enabled: !!state?.sent_at,
    queryFn: async () => {
      const { data } = await db.from("colombian_holidays").select("holiday_date, name").eq("holiday_date", state.sent_at);
      return data ?? [];
    },
  });
  const { data: sentLinks = [] } = useQuery({
    queryKey: ["peticion-sent-links", workItem.id],
    queryFn: async () => {
      const { data } = await db.from("work_item_email_links").select("id, subject, received_at")
        .eq("work_item_id", workItem.id).eq("link_status", "CONFIRMED").eq("direction", "sent").order("received_at", { ascending: true });
      return data ?? [];
    },
  });

  const current: CurrentAnchor | null = state ? {
    sent_at: state.sent_at, components: state.components ?? [], anchor_version: state.anchor_version ?? 0,
    anchor_source: state.anchor_source === "PRESENTACION_DOCUMENTADA" ? state.anchor_source : null,
  } : null;
  const hasAnchor = !!current?.anchor_source;
  const blank: PresentationForm = { presented_on: "", source: "USUARIO_DECLARADO", support: "", components: ["GENERAL_INTERVENCION"], reason: "", email_link_id: null };
  const [form, setForm] = useState<PresentationForm>(blank);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (state?.anchor_source === "PRESENTACION_DOCUMENTADA") setForm({
      presented_on: state.sent_at ?? "", source: state.presentation_source ?? "USUARIO_DECLARADO",
      support: state.presentation_support ?? "", components: state.components ?? [], reason: "",
      email_link_id: state.presentation_email_link_id ?? null,
    });
  }, [state]);

  const invalidate = () => {
    for (const k of ["peticion-state", "peticion-terms", "peticion-events"]) void qc.invalidateQueries({ queryKey: [k, workItem.id] });
    void qc.invalidateQueries({ queryKey: ["work-item-tasks"] });
    void qc.invalidateQueries({ queryKey: ["work-item-deadlines"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const errors = validatePresentation(form, todayBogota(), current);
      if (errors.length) throw new Error(errors.join(" "));
      const { data, error } = await db.rpc("peticion_register_presentation", buildPresentationRpcArgs(workItem.id, form, current));
      if (error) throw new Error(friendlyRpcError(error.message));
      return data;
    },
    onSuccess: (d: { idempotent?: boolean }) => {
      toast.success(d?.idempotent ? "Sin cambios: los plazos ya estaban registrados" : "Plazos calculados desde la presentación");
      setEditing(false); invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return null;
  const live = terms.filter((t) => !["CANCELLED"].includes(t.status));
  const history = terms.filter((t) => t.status === "CANCELLED");
  const holidayName = holidays[0]?.name as string | undefined;
  const toggle = (code: string) => setForm((f) => ({ ...f, components: f.components.includes(code) ? f.components.filter((c) => c !== code) : [...f.components, code] }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h4 className="font-medium">Términos de respuesta</h4>
        <p className="text-sm text-muted-foreground">
          Cálculo operativo de buena fe desde la presentación documentada (correo oficial o plataforma). No exige acuse ni radicado
          de la entidad, y no acredita por sí mismo la recepción. El día de presentación no se cuenta: el siguiente día hábil es el día 1
          (calendario de festivos de Colombia, sin vacancia judicial).
        </p>
      </div>

      {!hasAnchor && !editing && (
        <Alert>
          <AlertTitle>Falta la fecha de presentación</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>Sin esa fecha no hay plazo calculado. No se usa la fecha de creación del asunto.</p>
            <Button size="sm" onClick={() => setEditing(true)}>Registrar presentación</Button>
          </AlertDescription>
        </Alert>
      )}

      {hasAnchor && !editing && (
        <div className="space-y-1 rounded-md border p-3 text-sm">
          <p><b>Base:</b> presentada el {fmt(state.sent_at)}{holidayName ? ` (festivo: ${holidayName})` : ""} · versión {state.anchor_version}</p>
          <p><b>Origen:</b> {PRESENTATION_SOURCES.find((s) => s.code === state.presentation_source)?.label ?? state.presentation_source}</p>
          <p><b>Soporte:</b> {state.presentation_support}</p>
          <p className="text-muted-foreground">Estado probatorio: cálculo operativo desde presentación documentada. Si aparece rebote, canal incorrecto, otra fecha o traslado, corrija la fecha con motivo.</p>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Corregir fecha o componentes</Button>
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Fecha de presentación</Label><Input type="date" max={todayBogota()} value={form.presented_on} onChange={(e) => setForm((f) => ({ ...f, presented_on: e.target.value }))} /></div>
            <div className="space-y-1">
              <Label>Origen de la fecha</Label>
              <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v, email_link_id: v === "OUTLOOK" ? f.email_link_id : null }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRESENTATION_SOURCES.map((s) => <SelectItem key={s.code} value={s.code} disabled={s.code === "OUTLOOK" && sentLinks.length === 0}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {form.source === "OUTLOOK" && (
            <div className="space-y-1">
              <Label>Correo enviado vinculado</Label>
              <Select value={form.email_link_id ?? ""} onValueChange={(v) => {
                const l = sentLinks.find((x: { id: string }) => x.id === v);
                setForm((f) => ({ ...f, email_link_id: v, presented_on: l?.received_at ? new Date(new Date(l.received_at).getTime() - 5 * 3600_000).toISOString().slice(0, 10) : f.presented_on }));
              }}>
                <SelectTrigger><SelectValue placeholder="Seleccione el correo" /></SelectTrigger>
                <SelectContent>{sentLinks.map((l: { id: string; subject: string | null; received_at: string | null }) => <SelectItem key={l.id} value={l.id}>{(l.subject ?? "(sin asunto)").slice(0, 80)} · {l.received_at ? new Date(l.received_at).toLocaleDateString("es-CO") : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1"><Label>Soporte de la presentación</Label><Textarea value={form.support} onChange={(e) => setForm((f) => ({ ...f, support: e.target.value }))} placeholder="Ej.: correo enviado desde la cuenta de la firma al buzón oficial de la entidad" maxLength={1000} /></div>
          <div className="space-y-2">
            <Label>Componentes de la petición (cada uno tiene su propio vencimiento)</Label>
            {PETICION_COMPONENTS.map((c) => (
              <label key={c.code} className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.components.includes(c.code)} onCheckedChange={() => toggle(c.code)} />
                {c.label}{c.days ? ` — ${c.days} días hábiles` : ""}
              </label>
            ))}
          </div>
          {hasAnchor && <div className="space-y-1"><Label>Motivo de la corrección</Label><Textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Rebote, fecha real distinta, traslado, componente mal clasificado…" /></div>}
          <div className="flex gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Guardar y calcular plazos</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {live.length > 0 && (
        <ul className="divide-y rounded-md border">
          {live.map((t) => <TermRow key={t.deadline_id} term={t} onChanged={invalidate} />)}
        </ul>
      )}
      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Historial de plazos reemplazados ({history.length})</summary>
          <ul className="mt-2 space-y-1">
            {history.map((t) => <li key={t.deadline_id} className="text-muted-foreground">{componentLabel(t.component)}: {fmt(t.deadline_date)} — {t.closure_reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function TermRow({ term, onChanged }: { term: DeadlineRow; onChanged: () => void }) {
  const [mode, setMode] = useState<null | "ext" | "resp">(null);
  const [date, setDate] = useState(todayBogota());
  const [newDue, setNewDue] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"PARCIAL" | "DE_FONDO">("PARCIAL");
  const [reviewed, setReviewed] = useState(false);
  const act = useMutation({
    mutationFn: async () => {
      const { data, error } = mode === "ext"
        ? await db.rpc("peticion_register_extension", { p_deadline_id: term.deadline_id, p_communicated_on: date, p_new_due: newDue || null, p_motivation: text, p_reviewed: reviewed })
        : await db.rpc("peticion_register_response", { p_deadline_id: term.deadline_id, p_kind: kind, p_received_on: date, p_notes: text, p_reviewed: reviewed });
      if (error) throw new Error(friendlyRpcError(error.message));
      return data;
    },
    onSuccess: (d: { validity?: string; applied?: boolean; closed?: boolean }) => {
      if (mode === "ext") (d.applied ? toast.success : toast.warning)(EXTENSION_VALIDITY_LABELS[d.validity ?? ""] ?? "Prórroga registrada");
      else toast.success(d.closed ? "Componente cerrado por respuesta de fondo" : "Respuesta parcial registrada; el plazo sigue vigente");
      setMode(null); setText(""); setReviewed(false); onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const a = term.audit ?? {};
  const met = term.status === "MET";
  const overdue = term.deadline_status === "OVERDUE";
  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{componentLabel(term.component)}</span>
        {term.days && <Badge variant="outline">{term.days} días hábiles</Badge>}
        {met ? <Badge>Respondido</Badge> : overdue ? <Badge variant="destructive">Vencido</Badge> : term.deadline_date ? <Badge variant="secondary">Vigente</Badge> : <Badge variant="secondary">Revisión manual</Badge>}
        {term.trigger_event === "PRORROGA_COMUNICADA" && <Badge variant="outline">Prorrogado</Badge>}
      </div>
      {term.deadline_date ? (
        <p>Día 1: {fmt(a.first_business_day)} · Vence: <b>{fmt(term.deadline_date)}</b> · Evaluar tutela o revisión: {fmt(a.tutela_review_date)}
          {a.holidays_excluded && a.holidays_excluded.length > 0 && <> · Festivos excluidos: {a.holidays_excluded.map(fmt).join(", ")}</>}</p>
      ) : <p className="text-muted-foreground">Sin fecha calculada: requiere revisión del régimen especial o del calendario.</p>}
      {met && term.closure_reason && <p className="text-muted-foreground">{term.closure_reason}</p>}
      {!met && term.deadline_date && !mode && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMode("resp")}>Registrar respuesta</Button>
          <Button size="sm" variant="outline" onClick={() => setMode("ext")}>Registrar prórroga</Button>
        </div>
      )}
      {mode && (
        <div className="space-y-2 rounded-md bg-muted/40 p-2">
          {mode === "resp" && (
            <Select value={kind} onValueChange={(v) => setKind(v as "PARCIAL" | "DE_FONDO")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="PARCIAL">Respuesta parcial (no cierra)</SelectItem><SelectItem value="DE_FONDO">Respuesta de fondo de este componente</SelectItem></SelectContent>
            </Select>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1"><Label>{mode === "ext" ? "Fecha en que se comunicó la prórroga" : "Fecha de la respuesta"}</Label><Input type="date" max={todayBogota()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            {mode === "ext" && <div className="space-y-1"><Label>Nueva fecha anunciada</Label><Input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} /></div>}
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "ext" ? "Motivación expresada por la autoridad" : "Notas (sin copiar el cuerpo del correo)"} />
          <label className="flex items-center gap-2"><Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />
            {mode === "ext" ? "Revisé la comunicación: fue anterior al vencimiento y está motivada" : "Revisé jurídicamente la respuesta"}</label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => act.mutate()} disabled={act.isPending}>Guardar</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancelar</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function AuthorityForm({ workItem }: Props) {
  const qc = useQueryClient();
  const { data: state } = useQuery({
    queryKey: ["peticion-state", workItem.id],
    queryFn: async () => {
      const { data, error } = await db.from("peticion_work_item_state").select("*").eq("work_item_id", workItem.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [form, setForm] = useState<AuthorityFormData>({
    authority_name: workItem.authority_name ?? "", authority_email_domain: (workItem.authority_email ?? "").split("@")[1] ?? "", authority_radicado: "",
  });
  useEffect(() => {
    if (state) setForm({ authority_name: state.authority_name ?? workItem.authority_name ?? "", authority_email_domain: state.authority_email_domain ?? "", authority_radicado: state.authority_radicado ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const save = useMutation({
    mutationFn: async () => {
      const errors = validateAuthority(form);
      if (errors.length) throw new Error(errors.join(" "));
      const payload = buildAuthorityPayload(form, { work_item_id: workItem.id, owner_id: workItem.owner_id, organization_id: workItem.organization_id });
      const { error } = state
        ? await db.from("peticion_work_item_state").update(payload).eq("work_item_id", workItem.id)
        : await db.from("peticion_work_item_state").insert({ ...payload, subtype_code: "GENERAL" });
      if (error) throw error;
      await db.from("peticion_events").insert({
        work_item_id: workItem.id, organization_id: workItem.organization_id, owner_id: workItem.owner_id,
        event_code: "REGISTRO_ACTUALIZADO", event_date: todayBogota(), source: "USER",
        notes: "Datos de la autoridad actualizados manualmente (sin efecto en los plazos).",
        metadata: { before: state ? { authority_name: state.authority_name, authority_email_domain: state.authority_email_domain, authority_radicado: state.authority_radicado } : null, after: payload },
      });
    },
    onSuccess: () => { toast.success("Datos de la autoridad guardados"); void qc.invalidateQueries({ queryKey: ["peticion-state", workItem.id] }); void qc.invalidateQueries({ queryKey: ["peticion-events", workItem.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (k: keyof AuthorityFormData) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-3">
      <h4 className="font-medium">Autoridad</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>Autoridad</Label><Input value={form.authority_name} onChange={set("authority_name")} /></div>
        <div className="space-y-1"><Label>Dominio de correo</Label><Input value={form.authority_email_domain} onChange={set("authority_email_domain")} /></div>
        <div className="space-y-1"><Label>Radicado oficial (opcional)</Label><Input value={form.authority_radicado} onChange={set("authority_radicado")} placeholder="Pendiente" /></div>
      </div>
      <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>Guardar datos de la autoridad</Button>
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
