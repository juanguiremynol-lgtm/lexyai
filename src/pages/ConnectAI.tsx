/**
 * ConnectAI — public marketing page at /connect-ai (alias /mcp).
 * Explains how to plug any MCP-compatible assistant into Andromeda.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, ShieldCheck, Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import logo from "@/assets/andromeda-logo.png";

const MCP_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp`;

const STEPS = [
  {
    title: "Copia la dirección del servidor",
    body: "Es la misma para todas las herramientas. La encuentras aquí abajo y también dentro de Andromeda, en Ajustes → Conexiones.",
  },
  {
    title: "Agrégala como conector MCP",
    body: "En Claude: Ajustes → Conectores → Agregar conector personalizado. En ChatGPT: Ajustes → Conectores → Agregar. Pega la URL.",
  },
  {
    title: "Autoriza con tu cuenta",
    body: "Se abrirá la pantalla de consentimiento de Andromeda. Revisa los permisos y pulsa Autorizar. Listo: tu asistente ya ve tu cartera.",
  },
];

export default function ConnectAI() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-[#070b1a] text-[#e6edf7]">
      <div className="mx-auto max-w-3xl px-4 py-16 space-y-12">
        <header className="space-y-4 text-center">
          <img src={logo} alt="Andromeda" className="mx-auto h-24 w-auto object-contain" />
          <h1 className="text-3xl font-semibold sm:text-4xl">Conecta tu IA favorita a Andromeda</h1>
          <p className="text-[#a0b4d0]">
            Compatible con Claude, ChatGPT y cualquier herramienta que hable MCP. Pregúntale por tus términos,
            tus estados de hoy o el caso que tienes en Medellín — con los datos reales de tu cartera.
          </p>
        </header>

        <Card className="border-[#d4a017]/20 bg-[#0c1529]/80">
          <CardHeader>
            <CardTitle className="text-base">Dirección del servidor MCP</CardTitle>
            <CardDescription>Pega esta URL en la configuración de conectores de tu asistente.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md bg-black/40 px-3 py-2 text-sm">{MCP_URL}</code>
              <Button variant="outline" size="sm" onClick={copy} aria-label="Copiar dirección del servidor MCP">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">
                  Conectar con Claude
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="https://chatgpt.com/#settings/Connectors" target="_blank" rel="noopener noreferrer">
                  Conectar con ChatGPT
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Tres pasos</h2>
          <ol className="space-y-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4a017]/20 text-sm font-semibold text-[#d4a017]">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-[#a0b4d0]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: ShieldCheck, title: "Solo tu cartera", body: "Cada conexión usa tu identidad. Ninguna herramienta ve expedientes de otro abogado." },
            { icon: Lock, title: "Sin borrados", body: "El asistente nunca elimina, reclasifica ni cierra expedientes. Solo lee, y con permiso agrega notas y audiencias." },
            { icon: Sparkles, title: "Revocable", body: "Quita el acceso cuando quieras desde Ajustes → Conexiones." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <Icon className="mb-2 h-5 w-5 text-[#0ea5e9]" aria-hidden />
              <p className="font-medium">{title}</p>
              <p className="text-sm text-[#a0b4d0]">{body}</p>
            </div>
          ))}
        </section>

        <footer className="text-center text-sm text-[#a0b4d0]">
          ¿Ya tienes cuenta? <Link to="/app/settings/connections" className="underline">Gestiona tus conexiones</Link>.
        </footer>
      </div>
    </main>
  );
}