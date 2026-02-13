import type { BubbleContext } from "./mascot-bubbles";
import { trackMascotEvent } from "./mascot-analytics";

interface QuickPrompt {
  label: string;
  prompt: string;
}

const QUICK_PROMPTS: Partial<Record<BubbleContext, QuickPrompt[]>> = {
  GLOBAL: [
    { label: "¿Qué puedes hacer?", prompt: "¿Qué puedes hacer por mí?" },
    { label: "Estado de mi cuenta", prompt: "¿Cuál es el estado de mi suscripción?" },
  ],
  DASHBOARD: [
    { label: "Resumen del pipeline", prompt: "Dame un resumen del estado de mis asuntos" },
    { label: "Estado del sync", prompt: "¿Están sincronizados todos mis asuntos?" },
    { label: "¿Qué hay en la papelera?", prompt: "¿Qué asuntos tengo en la papelera?" },
  ],
  WORK_ITEM_DETAIL: [
    { label: "Resumir asunto", prompt: "Resume este asunto y sus últimas actuaciones" },
    { label: "Explicar trazas", prompt: "Explícame las trazas de sync de este asunto" },
    { label: "Explicar etapas", prompt: "Explícame las etapas de este tipo de proceso" },
  ],
  HOY: [
    { label: "Resumen de hoy", prompt: "Resume la actividad judicial de hoy" },
    { label: "¿Hay alertas pendientes?", prompt: "¿Hay alertas pendientes que deba revisar?" },
  ],
  AFTER_DELETE: [
    { label: "♻️ Recuperar asunto", prompt: "Quiero recuperar el asunto que acabo de eliminar" },
  ],
  SETTINGS: [
    { label: "Ayuda con suscripción", prompt: "¿Cuál es el estado de mi suscripción?" },
    { label: "Cambiar plan", prompt: "¿Cómo puedo cambiar mi plan?" },
  ],
  SUPERVISOR: [
    { label: "Auditoría de salud", prompt: "Hazme una auditoría de salud de la plataforma" },
    { label: "Estado del sync diario", prompt: "¿Cómo va el sync diario de hoy?" },
    { label: "Proveedores degradados", prompt: "¿Hay proveedores degradados?" },
  ],
};

interface QuickPromptsProps {
  contexts: BubbleContext[];
  onSelect: (prompt: string) => void;
}

export function QuickPrompts({ contexts, onSelect }: QuickPromptsProps) {
  const prompts = contexts
    .flatMap((c) => QUICK_PROMPTS[c] ?? [])
    .filter((p, i, arr) => arr.findIndex((x) => x.prompt === p.prompt) === i)
    .slice(0, 4);

  if (prompts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b">
      {prompts.map((p) => (
        <button
          key={p.prompt}
          onClick={() => {
            onSelect(p.prompt);
            trackMascotEvent("quick_prompt_clicked", { prompt: p.label });
          }}
          className="text-xs px-2.5 py-1.5 rounded-full border bg-background hover:bg-accent transition-colors"
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
