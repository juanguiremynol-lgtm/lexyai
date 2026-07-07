/**
 * Platform WhatsApp Page — Super Admin console for the Andrómeda WhatsApp agent.
 *
 * Tabs:
 *  - Credenciales: shows which Meta secrets are configured + activation toggle
 *  - Bandeja: live inbox with take-over/manual reply
 *  - Leads: new-prospect list from the bot
 *  - Identidades: verified phone-to-lawyer bindings
 *  - Configuración: business hours, admin email, rate limits, knowledge base
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { MessageCircle, KeyRound, Inbox, Users, ShieldCheck, Settings2, Send, CheckCircle2, XCircle, Loader2, Copy, KeySquare } from "lucide-react";

const REQUIRED_SECRETS = [
  { name: "WHATSAPP_ACCESS_TOKEN", label: "Access Token (permanente)", help: "Meta → App → WhatsApp → API Setup → Token permanente del System User." },
  { name: "WHATSAPP_PHONE_NUMBER_ID", label: "Phone Number ID", help: "Meta → WhatsApp → API Setup → From (Phone number ID)." },
  { name: "WHATSAPP_VERIFY_TOKEN", label: "Verify Token", help: "Cualquier string aleatorio; pégalo también en Meta → Webhooks → Verify token." },
  { name: "WHATSAPP_APP_SECRET", label: "App Secret", help: "Meta → App Settings → Basic → App Secret." },
];

export default function PlatformWhatsAppPage() {
  return (
    <div className="space-y-6 p-6">
      <Header />
      <Tabs defaultValue="credenciales" className="w-full">
        <TabsList className="grid grid-cols-5 w-full max-w-3xl">
          <TabsTrigger value="credenciales"><KeyRound className="h-4 w-4 mr-1.5" />Credenciales</TabsTrigger>
          <TabsTrigger value="bandeja"><Inbox className="h-4 w-4 mr-1.5" />Bandeja</TabsTrigger>
          <TabsTrigger value="leads"><Users className="h-4 w-4 mr-1.5" />Leads</TabsTrigger>
          <TabsTrigger value="identidades"><ShieldCheck className="h-4 w-4 mr-1.5" />Identidades</TabsTrigger>
          <TabsTrigger value="configuracion"><Settings2 className="h-4 w-4 mr-1.5" />Configuración</TabsTrigger>
        </TabsList>
        <TabsContent value="credenciales" className="mt-4"><CredencialesTab /></TabsContent>
        <TabsContent value="bandeja" className="mt-4"><BandejaTab /></TabsContent>
        <TabsContent value="leads" className="mt-4"><LeadsTab /></TabsContent>
        <TabsContent value="identidades" className="mt-4"><IdentidadesTab /></TabsContent>
        <TabsContent value="configuracion" className="mt-4"><ConfiguracionTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <MessageCircle className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-serif font-bold">WhatsApp</h2>
          <Badge variant="outline" className="uppercase tracking-wider text-xs">Andrómeda Bot</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Agente de atención al cliente vía WhatsApp para clientes actuales y prospectos.
        </p>
      </div>
    </div>
  );
}

function CredencialesTab() {
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const projectRef = (import.meta as { env?: Record<string, string> }).env?.VITE_SUPABASE_PROJECT_ID ?? "";
  const webhookUrl = projectRef ? `https://${projectRef}.supabase.co/functions/v1/whatsapp-webhook` : "";

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("whatsapp-check-secrets", { body: {} });
      if (!error && data) setStatus((data as { secrets?: Record<string, boolean> }).secrets ?? {});
      const { data: s } = await supabase.from("whatsapp_bot_settings").select("bot_enabled").eq("singleton", true).maybeSingle();
      setEnabled(Boolean(s?.bot_enabled));
      setLoading(false);
    })();
  }, []);

  const allSet = status && REQUIRED_SECRETS.every((s) => status[s.name]);

  const activate = async (next: boolean) => {
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_bot_settings")
      .update({ bot_enabled: next })
      .eq("singleton", true);
    setSaving(false);
    if (error) { toast.error("No se pudo actualizar: " + error.message); return; }
    setEnabled(next);
    toast.success(next ? "Bot activado" : "Bot desactivado");
  };

  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success("Copiado"); };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Credenciales de Meta (WhatsApp Business Cloud API)</CardTitle>
          <CardDescription>
            Guarda los 4 secretos en Configuración → Secretos del backend. Una vez guardados, la infraestructura queda lista y solo debes activar el bot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Verificando secretos…</div>
          ) : (
            REQUIRED_SECRETS.map((s) => {
              const ok = status?.[s.name];
              return (
                <div key={s.name} className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                      <span className="font-mono text-sm">{s.name}</span>
                      <Badge variant={ok ? "default" : "outline"} className="text-[10px]">{ok ? "configurado" : "faltante"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{s.label} — {s.help}</p>
                  </div>
                </div>
              );
            })
          )}

          {webhookUrl && (
            <div className="rounded-lg border border-dashed p-3 space-y-1 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Callback URL para Meta Webhook</span>
                <Button size="sm" variant="ghost" onClick={() => copy(webhookUrl)}><Copy className="h-3 w-3" /></Button>
              </div>
              <code className="text-xs break-all">{webhookUrl}</code>
              <p className="text-[11px] text-muted-foreground">Pega esta URL en Meta → WhatsApp → Configuration → Webhook. Verify Token = el valor guardado en WHATSAPP_VERIFY_TOKEN. Suscribe al campo <code>messages</code>.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activación</CardTitle>
          <CardDescription>Enciende el bot una vez las credenciales estén configuradas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">Bot de WhatsApp {enabled ? "activo" : "detenido"}</p>
              <p className="text-xs text-muted-foreground">
                {allSet ? "Todas las credenciales están configuradas." : "Faltan credenciales — se atenderá con respuesta manual."}
              </p>
            </div>
            <Switch checked={enabled} disabled={saving} onCheckedChange={activate} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface Conversation {
  id: string;
  phone_e164: string;
  status: string;
  organization_id: string | null;
  last_message_at: string | null;
}
interface Message {
  id: string;
  direction: string;
  body: string | null;
  status: string;
  created_at: string;
}

function BandejaTab() {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase
      .from("whatsapp_conversations")
      .select("id, phone_e164, status, organization_id, last_message_at")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100)
      .then(({ data }) => setConvs((data ?? []) as Conversation[]));
  }, []);

  useEffect(() => {
    if (!selected) return;
    supabase
      .from("whatsapp_messages")
      .select("id, direction, body, status, created_at")
      .eq("conversation_id", selected.id)
      .order("created_at", { ascending: true })
      .limit(200)
      .then(({ data }) => setMessages((data ?? []) as Message[]));
  }, [selected]);

  const send = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    const { error } = await supabase.functions.invoke("whatsapp-admin-send", {
      body: { conversation_id: selected.id, text: reply },
    });
    setSending(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success("Enviado");
    setReply("");
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body, status, created_at")
      .eq("conversation_id", selected.id)
      .order("created_at", { ascending: true })
      .limit(200);
    setMessages((data ?? []) as Message[]);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="md:col-span-1">
        <CardHeader><CardTitle className="text-base">Conversaciones</CardTitle></CardHeader>
        <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
          {convs.length === 0 && <p className="text-xs text-muted-foreground p-4">Sin conversaciones aún.</p>}
          {convs.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`w-full text-left px-3 py-2 border-b hover:bg-muted/40 ${selected?.id === c.id ? "bg-muted/50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs">{c.phone_e164}</span>
                <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground">{c.last_message_at ? new Date(c.last_message_at).toLocaleString("es-CO") : ""}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader><CardTitle className="text-base">{selected ? selected.phone_e164 : "Selecciona una conversación"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[55vh] overflow-y-auto space-y-2 rounded-lg border p-3 bg-muted/10">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-background border"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${m.direction === "out" ? "opacity-70" : "text-muted-foreground"}`}>
                    {new Date(m.created_at).toLocaleString("es-CO")} · {m.status}
                  </p>
                </div>
              </div>
            ))}
            {selected && messages.length === 0 && <p className="text-xs text-muted-foreground">Sin mensajes.</p>}
          </div>
          {selected && (
            <div className="flex items-end gap-2">
              <Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Escribe una respuesta manual (toma la conversación)…" />
              <Button onClick={send} disabled={sending || !reply.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LeadsTab() {
  const [leads, setLeads] = useState<Array<{ id: string; phone_e164: string; name: string | null; firm: string | null; interest_summary: string | null; status: string; created_at: string }>>([]);
  useEffect(() => {
    supabase.from("whatsapp_leads").select("id, phone_e164, name, firm, interest_summary, status, created_at").order("created_at", { ascending: false }).limit(200).then(({ data }) => setLeads((data ?? []) as never));
  }, []);
  return (
    <Card>
      <CardHeader><CardTitle>Leads / Prospectos</CardTitle></CardHeader>
      <CardContent>
        {leads.length === 0 && <p className="text-xs text-muted-foreground">Sin leads aún.</p>}
        <div className="space-y-2">
          {leads.map((l) => (
            <div key={l.id} className="rounded-lg border p-3">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium">{l.name ?? "(sin nombre)"}</p>
                  <p className="text-xs text-muted-foreground font-mono">{l.phone_e164} · {l.firm ?? "sin firma"}</p>
                </div>
                <Badge variant="outline">{l.status}</Badge>
              </div>
              {l.interest_summary && <p className="text-xs mt-2">{l.interest_summary}</p>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function IdentidadesTab() {
  const [rows, setRows] = useState<Array<{ id: string; phone_e164: string; display_name: string | null; status: string; verified_at: string | null; organization_id: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    supabase.from("whatsapp_identities").select("id, phone_e164, display_name, status, verified_at, organization_id").order("created_at", { ascending: false }).limit(200).then(({ data }) => { setRows((data ?? []) as never); setLoading(false); });
  }, []);
  const block = async (id: string) => {
    await supabase.from("whatsapp_identities").update({ status: "blocked" }).eq("id", id);
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, status: "blocked" } : r));
    toast.success("Identidad bloqueada");
  };
  const generate = async () => {
    setGenerating(true);
    setGeneratedCode(null);
    const { data, error } = await supabase.functions.invoke("whatsapp-generate-link-code", { body: {} });
    setGenerating(false);
    if (error) { toast.error("Error: " + error.message); return; }
    const d = data as { code: string; expires_at: string };
    setGeneratedCode({ code: d.code, expires_at: d.expires_at });
    toast.success("Código generado (válido 15 min)");
  };
  const copyCode = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode.code);
    toast.success("Código copiado");
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeySquare className="h-4 w-4" />Vincular mi WhatsApp</CardTitle>
          <CardDescription>
            Genera un código de 6 dígitos y envíalo por WhatsApp al bot para verificar tu número. Expira en 15 minutos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeySquare className="h-4 w-4 mr-2" />}
            Generar código de vinculación
          </Button>
          {generatedCode && (
            <div className="rounded-lg border border-dashed p-4 bg-muted/30 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Envía este código por WhatsApp al bot</p>
                <p className="text-3xl font-mono font-bold tracking-widest">{generatedCode.code}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Expira: {new Date(generatedCode.expires_at).toLocaleString("es-CO")}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyCode}><Copy className="h-3 w-3 mr-1" />Copiar</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Identidades vinculadas</CardTitle></CardHeader>
        <CardContent>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {!loading && rows.length === 0 && <p className="text-xs text-muted-foreground">Sin identidades registradas.</p>}
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-mono">{r.phone_e164}</p>
                <p className="text-xs text-muted-foreground">{r.display_name ?? "sin nombre"} · org {r.organization_id ?? "—"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={r.status === "verified" ? "default" : r.status === "blocked" ? "destructive" : "outline"}>{r.status}</Badge>
                {r.status !== "blocked" && <Button size="sm" variant="outline" onClick={() => block(r.id)}>Bloquear</Button>}
              </div>
            </div>
          ))}
        </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface BotSettings {
  bot_enabled: boolean;
  admin_notification_email: string | null;
  rate_limit_max: number;
  rate_limit_window_minutes: number;
  refresh_cooldown_minutes: number;
  services_knowledge_base: string;
}

function ConfiguracionTab() {
  const [s, setS] = useState<BotSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    supabase.from("whatsapp_bot_settings").select("bot_enabled, admin_notification_email, rate_limit_max, rate_limit_window_minutes, refresh_cooldown_minutes, services_knowledge_base").eq("singleton", true).maybeSingle().then(({ data }) => setS(data as BotSettings));
  }, []);
  const save = async () => {
    if (!s) return;
    setSaving(true);
    const { error } = await supabase.from("whatsapp_bot_settings").update(s).eq("singleton", true);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("Configuración guardada");
  };
  if (!s) return <Loader2 className="h-4 w-4 animate-spin" />;
  return (
    <Card>
      <CardHeader><CardTitle>Configuración del bot</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Correo de notificaciones administrativas</Label>
          <Input type="email" value={s.admin_notification_email ?? ""} onChange={(e) => setS({ ...s, admin_notification_email: e.target.value })} placeholder="admin@andromeda.legal" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-2">
            <Label>Rate limit (mensajes)</Label>
            <Input type="number" value={s.rate_limit_max} onChange={(e) => setS({ ...s, rate_limit_max: Number(e.target.value) })} />
          </div>
          <div className="grid gap-2">
            <Label>Ventana (minutos)</Label>
            <Input type="number" value={s.rate_limit_window_minutes} onChange={(e) => setS({ ...s, rate_limit_window_minutes: Number(e.target.value) })} />
          </div>
          <div className="grid gap-2">
            <Label>Cooldown refresh (min)</Label>
            <Input type="number" value={s.refresh_cooldown_minutes} onChange={(e) => setS({ ...s, refresh_cooldown_minutes: Number(e.target.value) })} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Base de conocimiento del servicio (usada por el bot)</Label>
          <Textarea rows={6} value={s.services_knowledge_base} onChange={(e) => setS({ ...s, services_knowledge_base: e.target.value })} />
        </div>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
      </CardContent>
    </Card>
  );
}
