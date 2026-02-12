/**
 * AteniaGeminiPanel — Embedded Gemini escalation for incident threads.
 * Multi-turn conversation within a side sheet.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateExportBundle } from "@/lib/services/atenia-ai-export";
import { addMessage } from "@/lib/services/atenia-ai-conversations";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, Send, Loader2 } from "lucide-react";

interface Props {
  conversationId: string;
  currentUserId: string;
}

const SUGGESTED_QUERIES = [
  {
    label: "Hipótesis de causa raíz",
    prompt: "¿Cuál es la hipótesis de causa raíz más probable para este incidente? Enumera las 3 causas más probables con nivel de confianza.",
  },
  {
    label: "Candidato de automatización",
    prompt: "Basado en este patrón de incidente, ¿qué acción automática nueva debería implementarse? Describe: trigger, acción, guardrails, y resultado esperado.",
  },
  {
    label: "¿Qué gates faltan?",
    prompt: "¿Qué gates de aseguramiento o validaciones adicionales deberían existir para detectar este tipo de problema antes?",
  },
  {
    label: "¿Mejor clasificación?",
    prompt: "¿Hay errores en este incidente que están mal clasificados? ¿Algún PROVIDER_NOT_FOUND debería ser EMPTY_RESULTS?",
  },
  {
    label: "Resumen ejecutivo",
    prompt: "Genera un resumen ejecutivo de este incidente en 3-4 oraciones: qué pasó, qué impacto tuvo, qué se hizo, y qué queda pendiente.",
  },
];

export function AteniaGeminiPanel({ conversationId, currentUserId }: Props) {
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const queryClient = useQueryClient();

  // Load Gemini messages for this conversation
  const { data: geminiMessages } = useQuery({
    queryKey: ["atenia-gemini-messages", conversationId],
    queryFn: async () => {
      const { data } = await (supabase
        .from("atenia_ai_op_messages") as any)
        .select("*")
        .eq("conversation_id", conversationId)
        .in("role", ["admin", "gemini"])
        .order("created_at", { ascending: true });

      // Filter to only gemini escalation messages
      return (data || []).filter(
        (m: any) =>
          m.role === "gemini" ||
          (m.role === "admin" && m.content_structured?.target === "gemini_escalation")
      );
    },
  });

  const handleAsk = async (promptText?: string) => {
    const q = promptText || question;
    if (!q.trim()) return;

    setIsAsking(true);
    try {
      // Generate fresh bundle
      const bundle = await generateExportBundle(conversationId, "MARKDOWN", currentUserId);

      // Build system prompt
      const systemPrompt = `Eres un asistente de diagnóstico para la plataforma ATENIA, un sistema de gestión de casos judiciales en Colombia.

Se te proporciona un bundle de incidente redactado. Analiza el incidente y responde a la pregunta del administrador.

REGLAS:
- Responde siempre en español
- Basa tu análisis SOLO en los datos del bundle — no inventes datos
- Si necesitas más información, indica qué datos adicionales serían útiles
- Nunca reveles ni solicites secrets, tokens, o claves API
- No tienes acceso al código fuente — solo al bundle de incidente
- Tus sugerencias deben estar dentro del plano operacional (retries, suspensiones, mitigaciones), NUNCA cambios de código o schema

CONTEXTO DEL INCIDENTE:
${bundle}`;

      // Build messages for multi-turn
      const previousMessages = (geminiMessages || []).map((m: any) => ({
        role: m.role === "admin" ? "user" : "model",
        parts: [{ text: m.content_text }],
      }));

      // Call Gemini via edge function
      const { data: response, error } = await supabase.functions.invoke("gemini-chat", {
        body: {
          systemPrompt,
          messages: [...previousMessages, { role: "user", parts: [{ text: q }] }],
        },
      });

      const geminiText = error
        ? `Error al consultar Gemini: ${error.message}`
        : response?.text || "Sin respuesta de Gemini.";

      // Store admin question
      await addMessage(
        conversationId,
        "admin",
        q,
        currentUserId,
        { target: "gemini_escalation" },
      );

      // Store Gemini response
      await addMessage(
        conversationId,
        "gemini",
        geminiText,
        undefined,
        { source: "gemini_escalation", model: response?.model },
      );

      setQuestion("");
      queryClient.invalidateQueries({ queryKey: ["atenia-gemini-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["atenia-thread-timeline", conversationId] });
    } catch (err: any) {
      console.warn("[GeminiPanel] Error:", err);
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 mt-4">
      {/* Transparency notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Gemini recibe únicamente el bundle redactado de este incidente.
          No tiene acceso al código fuente, secrets, ni a datos de otros incidentes.
        </AlertDescription>
      </Alert>

      {/* Suggested queries */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Sugerencias rápidas:</p>
        <div className="flex flex-wrap gap-1">
          {SUGGESTED_QUERIES.map((sq) => (
            <Button
              key={sq.label}
              variant="outline"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => handleAsk(sq.prompt)}
              disabled={isAsking}
            >
              {sq.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto space-y-3 border rounded-lg p-3 min-h-[200px]">
        {(!geminiMessages || geminiMessages.length === 0) && !isAsking && (
          <p className="text-xs text-muted-foreground text-center py-8">
            Haz una pregunta sobre este incidente
          </p>
        )}
        {(geminiMessages || []).map((msg: any, idx: number) => (
          <div
            key={idx}
            className={`text-xs p-2 rounded-lg ${
              msg.role === "admin"
                ? "bg-primary/10 ml-4"
                : "bg-muted mr-4"
            }`}
          >
            <div className="flex items-center gap-1 mb-1 text-[10px] text-muted-foreground">
              <span>{msg.role === "admin" ? "👤 Admin" : "🤖 Gemini"}</span>
            </div>
            <p className="whitespace-pre-wrap">{msg.content_text}</p>
          </div>
        ))}
        {isAsking && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Gemini está analizando...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <Textarea
          placeholder="Escribir pregunta personalizada..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="min-h-[60px] text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAsk();
            }
          }}
        />
        <Button
          size="sm"
          onClick={() => handleAsk()}
          disabled={isAsking || !question.trim()}
          className="self-end"
        >
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
