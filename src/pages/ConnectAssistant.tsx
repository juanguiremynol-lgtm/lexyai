import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, ShieldCheck, Plug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AI_CONNECTIONS_PATH, MANAGEMENT_SCOPE, MANAGEMENT_BOUNDARY } from "@/lib/mcp-consent";
const MCP_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp`;
export default function ConnectAssistant() {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(MCP_URL); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return <main className="container max-w-3xl py-8 space-y-6">
    <header className="space-y-2"><h1 className="text-3xl font-semibold flex items-start gap-2"><Plug className="h-7 w-7 shrink-0 text-primary" />Conectar asistentes de IA</h1><p className="text-muted-foreground">Conecta tu asistente a Andromeda con tu propia cuenta y el permiso que tú elijas.</p></header>
    <Card><CardHeader><CardTitle>Dirección del servidor</CardTitle><CardDescription>Copia la dirección y agrégala como conexión en tu asistente.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex gap-2 items-center"><code className="flex-1 min-w-0 rounded-md bg-muted px-3 py-2 text-sm break-all">{MCP_URL}</code><Button variant="outline" size="icon" onClick={copy} aria-label="Copiar dirección del servidor">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button></div><ol className="list-decimal space-y-2 pl-5 text-sm"><li>Agrega la dirección en la sección de conexiones de tu asistente.</li><li>Inicia sesión en Andromeda y revisa la cuenta y el nombre de la herramienta.</li><li>Elige «Solo consultar» o «Consultar y gestionar» y confirma. También puedes elegir al volver a conectar.</li></ol></CardContent></Card>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Tú eliges el permiso</h2><p className="text-sm text-muted-foreground">Solo consultar permite ver asuntos, actuaciones, estados, clientes, términos, audiencias y tareas, sin hacer cambios.</p><p className="text-sm font-medium">Consultar y gestionar añade:</p><ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">{MANAGEMENT_SCOPE.map(text => <li key={text}>{text}</li>)}</ul><p className="flex items-start gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0 text-primary" />{MANAGEMENT_BOUNDARY}</p></section>
    <Button asChild variant="outline"><Link to={AI_CONNECTIONS_PATH}>Cambiar permisos o revocar acceso</Link></Button>
  </main>;
}
