/**
 * Avisos por WhatsApp a clientes — cola de aprobación.
 *
 * Reglas estructurales (no editoriales):
 *  - Un borrador sólo existe si el hecho viene del proveedor y el cliente tiene
 *    consentimiento vigente. Nada de términos, plazos ni fechas calculadas.
 *  - Nada se aprueba solo. No hay aprobación masiva.
 *  - Un borrador con más de 7 días expira en vez de enviarse.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { toast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, ExternalLink, ShieldCheck, ShieldOff, RefreshCw, Send } from "lucide-react";

// "Forma del consentimiento" es texto libre: lo escribe el abogado con sus
// propias palabras. No hay lista cerrada inventada por el sistema.

function fmt(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

export default function ClientWhatsAppNotices() {
  const { organization } = useOrganization();
  const qc = useQueryClient();
  const orgId = organization?.id;

  const [editing, setEditing] = useState<Record<string, string>>({});
  const [discardReason, setDiscardReason] = useState<Record<string, string>>({});

  const drafts = useQuery({
    queryKey: ["wa-client-drafts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_wa_drafts")
        .select(
          "id, client_id, work_item_id, source_kind, source_table, source_id, fact_date, body_text, edited_body_text, status, expires_at, created_at, clients(name), work_items(radicado, title)",
        )
        .eq("organization_id", orgId!)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const consents = useQuery({
    queryKey: ["wa-client-consents", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_wa_consent")
        .select("id, client_id, phone_e164, consent_method, consent_note, granted_at, revoked_at, clients(name)")
        .eq("organization_id", orgId!)
        .order("granted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Borradores ya aprobados que no llegaron a enviarse (fallo del proveedor,
  // perfil incompleto, WhatsApp sin conectar). Deben seguir a la vista con un
  // reintento explícito: un aviso aprobado nunca puede desaparecer en silencio.
  const stuck = useQuery({
    queryKey: ["wa-client-stuck", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_wa_drafts")
        .select(
          "id, client_id, work_item_id, source_kind, fact_date, body_text, edited_body_text, status, expires_at, approved_at, clients(name), work_items(radicado, title)",
        )
        .eq("organization_id", orgId!)
        .in("status", ["APPROVED", "SENDING", "FAILED"])
        .order("approved_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const sends = useQuery({
    queryKey: ["wa-client-sends", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      // client_wa_sends no tiene llave foránea hacia clients: el nombre se
      // resuelve en el cliente, no con un embed que PostgREST rechaza.
      const { data, error } = await supabase
        .from("client_wa_sends")
        .select("id, client_id, body_text, phone_e164, sent_at, delivery_status, error_text")
        .eq("organization_id", orgId!)
        .order("sent_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });


  const clients = useQuery({
    queryKey: ["wa-clients", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name")
        .eq("organization_id", orgId!)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients.data ?? []) m.set(c.id, c.name);
    return m;
  }, [clients.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wa-client-drafts", orgId] });
    qc.invalidateQueries({ queryKey: ["wa-client-stuck", orgId] });
    qc.invalidateQueries({ queryKey: ["wa-client-consents", orgId] });
    qc.invalidateQueries({ queryKey: ["wa-client-sends", orgId] });
  };


  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("client_wa_generate_drafts", {
        _org: orgId!,
        _lookback_days: 7,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      toast({ title: `${n} borrador(es) nuevo(s)` });
      refresh();
    },
    onError: (e: Error) => toast({ title: "No se pudieron preparar los borradores", description: e.message, variant: "destructive" }),
  });

  const approveAndSend = useMutation({
    mutationFn: async (draftId: string) => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) throw new Error("Sesión no válida");
      const edited = editing[draftId];
      const { error } = await supabase
        .from("client_wa_drafts")
        .update({
          status: "APPROVED",
          approved_by: uid,
          approved_at: new Date().toISOString(),
          ...(edited ? { edited_body_text: edited } : {}),
        })
        .eq("id", draftId)
        .eq("status", "PENDING");
      if (error) throw error;

      const { data, error: fnErr } = await supabase.functions.invoke("whatsapp-send-client-notice", {
        body: { draft_id: draftId },
      });
      if (fnErr) {
        const details = await (fnErr as { context?: { text?: () => Promise<string> } })?.context?.text?.();
        throw new Error(details || fnErr.message);
      }
      return data;
    },
    onSuccess: () => {
      toast({ title: "Aviso enviado" });
      refresh();
    },
    onError: (e: Error) =>
      toast({ title: "No se envió", description: e.message.slice(0, 300), variant: "destructive" }),
  });

  const discard = useMutation({
    mutationFn: async (draftId: string) => {
      const reason = (discardReason[draftId] ?? "").trim();
      if (!reason) throw new Error("Escriba por qué lo descarta");
      const { error } = await supabase
        .from("client_wa_drafts")
        .update({ status: "DISCARDED", discard_reason: reason })
        .eq("id", draftId)
        .eq("status", "PENDING");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Borrador descartado" });
      refresh();
    },
    onError: (e: Error) => toast({ title: "No se descartó", description: e.message, variant: "destructive" }),
  });

  // ── Consentimiento ───────────────────────────────────────────────
  const [newClient, setNewClient] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newMethod, setNewMethod] = useState("");
  const [newNote, setNewNote] = useState("");

  const recordConsent = useMutation({
    mutationFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) throw new Error("Sesión no válida");
      const phone = newPhone.replace(/[^0-9]/g, "");
      if (!/^[1-9][0-9]{7,14}$/.test(phone)) {
        throw new Error("Número con indicativo del país y sin el signo +, por ejemplo 573001112233");
      }
      if (!newClient) throw new Error("Seleccione el cliente");
      if (!newMethod.trim()) throw new Error("Escriba cómo dio el cliente su consentimiento");
      const { error } = await supabase.from("client_wa_consent").insert({
        organization_id: orgId!,
        client_id: newClient,
        phone_e164: phone,
        consent_method: newMethod,
        consent_note: newNote || null,
        granted_by: uid,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Consentimiento registrado" });
      setNewClient("");
      setNewPhone("");
      setNewMethod("");
      setNewNote("");
      refresh();
    },
    onError: (e: Error) => toast({ title: "No se registró", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("client_wa_consent")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: userRes?.user?.id ?? null,
          revocation_reason: "Revocado por el abogado",
        })
        .eq("id", id);
      if (error) throw error;
      // La revocación también detiene la creación de borradores: se retiran los pendientes.
      await supabase
        .from("client_wa_drafts")
        .update({ status: "DISCARDED", discard_reason: "Consentimiento revocado" })
        .eq("consent_id", id)
        .eq("status", "PENDING");
    },
    onSuccess: () => {
      toast({ title: "Consentimiento revocado" });
      refresh();
    },
    onError: (e: Error) => toast({ title: "No se revocó", description: e.message, variant: "destructive" }),
  });

  const activeConsents = useMemo(
    () => (consents.data ?? []).filter((c) => !c.revoked_at),
    [consents.data],
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <MessageSquare className="h-6 w-6 text-primary" />
            Avisos por WhatsApp a clientes
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada mensaje se envía únicamente después de que usted lo lea y lo apruebe. Nada sale solo.
          </p>
        </div>
        <Button variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending || !orgId}>
          <RefreshCw className={`mr-2 h-4 w-4 ${generate.isPending ? "animate-spin" : ""}`} />
          Preparar borradores
        </Button>
      </div>

      <Tabs defaultValue="cola">
        <TabsList>
          <TabsTrigger value="cola">Por aprobar ({drafts.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="consent">Consentimientos ({activeConsents.length})</TabsTrigger>
          <TabsTrigger value="enviados">Enviados</TabsTrigger>
        </TabsList>

        {/* ── Cola ─────────────────────────────────────────────── */}
        <TabsContent value="cola" className="space-y-4 pt-4">
          {drafts.isLoading && <Skeleton className="h-32 w-full" />}
          {!drafts.isLoading && (drafts.data?.length ?? 0) === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No hay borradores por aprobar. Sólo se preparan avisos de clientes con consentimiento
                vigente y únicamente sobre hechos reportados por el sistema de consulta judicial.
              </CardContent>
            </Card>
          )}
          {(drafts.data ?? []).map((d) => {
            const wi = d.work_items as { radicado?: string; title?: string } | null;
            const cl = d.clients as { name?: string } | null;
            const text = editing[d.id] ?? d.edited_body_text ?? d.body_text;
            return (
              <Card key={d.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{cl?.name ?? "Cliente"}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{d.source_kind === "ESTADO" ? "Estado" : "Actuación"}</Badge>
                      <Badge variant="outline">Hecho del {fmt(d.fact_date)}</Badge>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {wi?.title || wi?.radicado}{" "}
                    <Link
                      to={`/app/work-items/${d.work_item_id}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      ver el expediente <ExternalLink className="h-3 w-3" />
                    </Link>
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea
                    value={text}
                    rows={3}
                    onChange={(e) => setEditing((p) => ({ ...p, [d.id]: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Vence el {fmt(d.expires_at)} — después de esa fecha no se envía.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => approveAndSend.mutate(d.id)}
                      disabled={approveAndSend.isPending}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Aprobar y enviar
                    </Button>
                    <Input
                      className="w-64"
                      placeholder="Motivo para descartarlo"
                      value={discardReason[d.id] ?? ""}
                      onChange={(e) => setDiscardReason((p) => ({ ...p, [d.id]: e.target.value }))}
                    />
                    <Button variant="outline" onClick={() => discard.mutate(d.id)} disabled={discard.isPending}>
                      Descartar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ── Consentimientos ──────────────────────────────────── */}
        <TabsContent value="consent" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registrar consentimiento</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <Select value={newClient} onValueChange={setNewClient}>
                <SelectTrigger>
                  <SelectValue placeholder="Cliente" />
                </SelectTrigger>
                <SelectContent>
                  {(clients.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Número con indicativo, sin +. Ej: 573001112233"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <Input
                placeholder="Cómo lo autorizó (con sus palabras). Ej: me lo autorizó en la oficina el 12/09"
                value={newMethod}
                onChange={(e) => setNewMethod(e.target.value)}
              />
              <Input
                placeholder="Nota (opcional)"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <div className="md:col-span-2">
                <Button onClick={() => recordConsent.mutate()} disabled={recordConsent.isPending}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Registrar
                </Button>
              </div>
            </CardContent>
          </Card>

          {(consents.data ?? []).map((c) => {
            const cl = c.clients as { name?: string } | null;
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="text-sm">
                    <p className="font-medium">{cl?.name ?? "Cliente"}</p>
                    <p className="text-muted-foreground">
                      {c.phone_e164} · {c.consent_method} ·{" "}
                      {fmt(c.granted_at)}
                      {c.consent_note ? ` · ${c.consent_note}` : ""}
                    </p>
                  </div>
                  {c.revoked_at ? (
                    <Badge variant="destructive">Revocado el {fmt(c.revoked_at)}</Badge>
                  ) : (
                    <Button variant="outline" onClick={() => revoke.mutate(c.id)} disabled={revoke.isPending}>
                      <ShieldOff className="mr-2 h-4 w-4" />
                      Revocar
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ── Enviados ─────────────────────────────────────────── */}
        <TabsContent value="enviados" className="space-y-3 pt-4">
          {(sends.data ?? []).length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Todavía no se ha enviado ningún aviso.
              </CardContent>
            </Card>
          )}
          {(sends.data ?? []).map((s) => (
            <Card key={s.id}>
              <CardContent className="space-y-1 py-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {(s.clients as { name?: string } | null)?.name ?? "Cliente"} · {s.phone_e164}
                  </span>
                  <Badge variant={s.delivery_status === "FAILED" ? "destructive" : "secondary"}>
                    {s.delivery_status}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{s.body_text}</p>
                <p className="text-xs text-muted-foreground">Enviado el {fmt(s.sent_at)}</p>
                {s.error_text && <p className="text-xs text-destructive">{s.error_text}</p>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
