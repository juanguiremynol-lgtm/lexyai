/**
 * EmailProviderAIGuide — Contextual Gemini AI assistance for email provider wizard.
 * Provides step-specific guidance to make configuration mistake-proof.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Loader2, Bot, Info, AlertTriangle, CheckCircle, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  step: string;
  provider: string | null;
}

const STEP_TIPS: Record<string, { title: string; tips: string[]; warning?: string }> = {
  select: {
    title: "Elegir el proveedor correcto",
    tips: [
      "Resend es recomendado por su simplicidad y buena deliverability.",
      "SendGrid y Mailgun son opciones maduras con alto volumen.",
      "AWS SES es el más económico a gran escala pero requiere configuración IAM.",
      "SMTP personalizado es para servidores propios o corporativos.",
    ],
  },
  configure: {
    title: "Configurar credenciales",
    tips: [
      "Nunca comparta sus API Keys. Se almacenan cifradas.",
      "Use claves específicas de API, no claves de cuenta general.",
      "El email 'From' debe estar verificado en su proveedor.",
      "Guarde sus claves en un lugar seguro antes de ingresarlas aquí.",
    ],
    warning: "Asegúrese de que su dominio esté verificado en el proveedor antes de continuar.",
  },
  test: {
    title: "Verificar la conexión",
    tips: [
      "La prueba verifica que la API key sea válida.",
      "Si falla, revise que la key no tenga restricciones de IP.",
      "Algunos proveedores tardan unos minutos en activar nuevas keys.",
      "Si usa sandbox, la prueba puede tener limitaciones.",
    ],
  },
  activate: {
    title: "Activar el proveedor",
    tips: [
      "Una vez activado, todos los emails usarán este proveedor.",
      "Puede cambiar de proveedor en cualquier momento.",
      "Cada cambio queda registrado en auditoría.",
      "Recomendamos probar en sandbox antes de activar en producción.",
    ],
    warning: "Verifique que su dominio sender esté configurado correctamente para evitar que los emails lleguen a spam.",
  },
  done: {
    title: "¡Configuración completa!",
    tips: [
      "Monitoree los emails enviados en Email Ops.",
      "Configure webhooks para rastreo de delivery.",
      "Puede actualizar claves sin interrumpir el servicio.",
    ],
  },
};

export function EmailProviderAIGuide({ step, provider }: Props) {
  const [question, setQuestion] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const tips = STEP_TIPS[step] || STEP_TIPS.select;

  const askAI = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAiResponse("");

    try {
      const context = `
El usuario está configurando un proveedor de email externo en la plataforma Atenia.
Paso actual: ${step}
Proveedor seleccionado: ${provider || "ninguno aún"}

Responde de forma clara, concisa y práctica. 
No reveles secretos ni información interna de la plataforma.
Responde en español.
Si preguntan sobre un proveedor específico, da instrucciones exactas de dónde encontrar las keys.
`.trim();

      const { data, error } = await supabase.functions.invoke("provider-wizard-ai-guide", {
        body: {
          messages: [
            { role: "system", content: context },
            { role: "user", content: question },
          ],
          mode: "email_provider_wizard",
        },
      });

      if (error) throw error;
      setAiResponse(data?.response || data?.text || "No pude obtener una respuesta. Intente de nuevo.");
    } catch (err) {
      setAiResponse("Error al consultar el asistente. Verifique su conexión e intente de nuevo.");
    } finally {
      setLoading(false);
      setQuestion("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Tips Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            {tips.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tips.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <span>{tip}</span>
            </div>
          ))}
          {tips.warning && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20 mt-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              <span className="text-xs text-amber-700 dark:text-amber-400">{tips.warning}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Guide */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Asistente Atenia AI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pregunte cualquier duda sobre la configuración del proveedor de email.
          </p>

          {aiResponse && (
            <div className="p-3 rounded-lg bg-accent/50 border text-sm">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                <Bot className="h-3 w-3" />
                Atenia AI
              </div>
              <p className="text-foreground whitespace-pre-wrap">{aiResponse}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea
              placeholder="Ej: ¿Dónde encuentro la API Key de Resend?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[60px] text-sm resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askAI();
                }
              }}
            />
          </div>
          <Button
            size="sm"
            onClick={askAI}
            disabled={loading || !question.trim()}
            className="w-full gap-2"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {loading ? "Consultando..." : "Preguntar"}
          </Button>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Shield className="h-3 w-3" />
            Atenia AI solo accede a configuración pública. Nunca ve sus claves secretas.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
