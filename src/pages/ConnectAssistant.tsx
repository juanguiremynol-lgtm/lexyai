import { useState } from "react";
import { Copy, Check, ShieldCheck, Plug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const MCP_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp`;

const TOOLS: Array<{ name: string; desc: string; write?: boolean }> = [
  { name: "get_user_context", desc: "Perfil del abogado y tamaño de la cartera" },
  { name: "list_work_items", desc: "Listado de asuntos" },
  { name: "get_work_item", desc: "Detalle de un asunto" },
  { name: "list_actuaciones", desc: "Actuaciones de un asunto" },
  { name: "list_publicaciones", desc: "Estados electrónicos de un asunto" },
  { name: "list_recent_estados", desc: "Novedades recientes de la cartera" },
  { name: "get_estados_hoy", desc: "Estados fijados hoy (America/Bogota)" },
  { name: "get_actuaciones_hoy", desc: "Actuaciones de hoy o de la última semana" },
  { name: "list_deadlines", desc: "Términos procesales vigentes" },
  { name: "list_clients", desc: "Clientes y número de asuntos" },
  { name: "get_client", desc: "Detalle de un cliente" },
  { name: "add_note", desc: "Agregar una nota a un asunto", write: true },
];

export default function ConnectAssistant() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold flex items-center gap-2">
          <Plug className="h-7 w-7 text-primary" aria-hidden />
          Conectar asistentes de IA
        </h1>
        <p className="text-muted-foreground">
          Conecta Claude, ChatGPT, Cursor u otra herramienta compatible con MCP a tu cuenta de Andromeda.
          La herramienta accederá únicamente a tus expedientes, con tu propia identidad.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Dirección del servidor</CardTitle>
          <CardDescription>Pega esta URL en la configuración de conectores de tu asistente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all">{MCP_URL}</code>
            <Button variant="outline" size="sm" onClick={copy} aria-label="Copiar dirección del servidor">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Abre la sección de conectores o herramientas de tu asistente y agrega un servidor MCP.</li>
            <li>Pega la dirección de arriba y guarda.</li>
            <li>El asistente te llevará a Andromeda para iniciar sesión y autorizar el acceso.</li>
            <li>Aprueba la pantalla de consentimiento. Listo: el asistente ya puede consultar tus expedientes.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qué puede hacer el asistente</CardTitle>
          <CardDescription>Solo lectura, salvo la creación de notas.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <div key={tool.name} className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <code className="text-xs font-medium">{tool.name}</code>
                <Badge variant={tool.write ? "default" : "secondary"} className="text-[10px]">
                  {tool.write ? "escritura" : "lectura"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{tool.desc}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Alert>
        <ShieldCheck className="h-4 w-4" aria-hidden />
        <AlertDescription className="space-y-1">
          <p>
            El acceso se autoriza con OAuth 2.1: la herramienta nunca recibe tu contraseña y solo ve los datos que tus
            permisos permiten.
          </p>
          <p>
            Ninguna herramienta externa puede eliminar, reclasificar ni pausar expedientes. Para revocar el acceso,
            elimina el conector desde la aplicación de IA y cierra sesiones en Ajustes.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}
