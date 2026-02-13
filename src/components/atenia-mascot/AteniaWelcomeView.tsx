/**
 * AteniaWelcomeView — Welcome screen shown when chat panel opens with no messages.
 * Displays greeting, grouped capabilities, and context-aware starter chips.
 * Enforces identity separation: end-user assistant vs super-admin console.
 */

import { Bot, Wrench, Briefcase, ShieldAlert, Sparkles, Lock, Settings, CreditCard } from "lucide-react";
import { trackMascotEvent } from "./mascot-analytics";
import type { BubbleContext } from "./mascot-bubbles";
import { useLocation } from "react-router-dom";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";

interface StarterChip {
  label: string;
  prompt: string;
  icon?: React.ReactNode;
}

interface CapabilityGroup {
  title: string;
  description: string;
  icon: React.ReactNode;
  chips: StarterChip[];
}

const SUPPORT_CHIPS: StarterChip[] = [
  { label: "¿Por qué no sincronizó mi asunto?", prompt: "¿Por qué no se sincronizó mi asunto? Analiza los traces recientes." },
  { label: "Ejecutar diagnóstico de radicado", prompt: "Ejecuta un diagnóstico completo para mi radicado actual" },
  { label: "Explicar este error", prompt: "Explícame qué significa este error y cómo solucionarlo" },
  { label: "¿Qué significa 'Missing stages: MAPPING_APPLIED'?", prompt: "¿Qué significa el error 'Missing stages: MAPPING_APPLIED' y cómo se soluciona?" },
  { label: "¿Mis conectores están sanos?", prompt: "¿Cómo puedo verificar que mis conectores están funcionando correctamente?" },
];

const WORK_ITEM_CHIPS: StarterChip[] = [
  { label: "¿Qué es un Número de Radicado?", prompt: "¿Qué es un Número de Radicado y cómo se valida?" },
  { label: "¿Qué proveedor usa esta categoría?", prompt: "¿Qué proveedor de datos se usa para esta categoría de asunto?" },
  { label: "¿Por qué no se auto-llenan las partes?", prompt: "¿Por qué el wizard de creación no está auto-llenando las partes procesales?" },
  { label: "Mostrar datos obtenidos de este asunto", prompt: "Muéstrame los datos que se obtuvieron de los proveedores para este asunto" },
  { label: "Resumir últimas actuaciones", prompt: "Resume las últimas actuaciones de este asunto. ¿Hay algo urgente?" },
];

const GATED_CHIPS: StarterChip[] = [
  { label: "♻️ Recuperar asunto eliminado", prompt: "Quiero recuperar un asunto que eliminé recientemente" },
  { label: "♻️ Recuperar cliente eliminado", prompt: "Quiero recuperar un cliente que eliminé recientemente" },
  { label: "🔓 Habilitar purga (hard delete)", prompt: "Quiero habilitar la sección de purga (eliminación permanente) en configuración" },
  { label: "⚠️ Explicar qué hace la purga", prompt: "Explícame qué hace la purga (eliminación permanente) y cuáles son los riesgos" },
];

const SETTINGS_CHIPS: StarterChip[] = [
  { label: "📻 Desactivar ticker", prompt: "Quiero desactivar el ticker de estados en vivo" },
  { label: "📻 Activar ticker", prompt: "Quiero activar el ticker de estados en vivo" },
  { label: "💳 Estado de mi suscripción", prompt: "¿Cuál es el estado de mi suscripción?" },
  { label: "📄 Resumen de facturación", prompt: "Dame un resumen de mi historial de facturación" },
  { label: "🎫 Generar certificado de servicio", prompt: "Genera un certificado de servicio para mi organización" },
];

function buildCapabilityGroups(isPlatformAdmin: boolean): CapabilityGroup[] {
  const groups: CapabilityGroup[] = [
    {
      title: "Soporte y diagnóstico",
      description: "Diagnósticos de sync, explicación de errores, pasos de solución",
      icon: <Wrench className="h-4 w-4" />,
      chips: SUPPORT_CHIPS,
    },
    {
      title: "Asuntos judiciales",
      description: "Radicados, datos de proveedores, interpretación de trazas",
      icon: <Briefcase className="h-4 w-4" />,
      chips: WORK_ITEM_CHIPS,
    },
    {
      title: "Configuración y cuenta",
      description: "Ticker, suscripción, facturación",
      icon: <Settings className="h-4 w-4" />,
      chips: SETTINGS_CHIPS,
    },
    {
      title: "Acciones protegidas",
      description: "Recuperación de eliminados, habilitación de purga",
      icon: <ShieldAlert className="h-4 w-4" />,
      chips: GATED_CHIPS,
    },
  ];

  return groups;
}

function getContextualChips(contexts: BubbleContext[], pathname: string): StarterChip[] {
  const contextual: StarterChip[] = [];

  if (contexts.includes("WORK_ITEM_DETAIL")) {
    contextual.push(
      { label: "Resumir este asunto", prompt: "Resume este asunto y sus últimas actuaciones" },
      { label: "Explicar trazas de sync", prompt: "Explícame las trazas de sincronización de este asunto" },
    );
  }

  if (contexts.includes("DASHBOARD")) {
    contextual.push(
      { label: "Resumen del pipeline", prompt: "Dame un resumen del estado de mis asuntos" },
      { label: "¿Qué hay en la papelera?", prompt: "¿Qué asuntos tengo en la papelera?" },
    );
  }

  if (contexts.includes("SETTINGS")) {
    contextual.push(
      { label: "📻 Desactivar ticker", prompt: "Quiero desactivar el ticker de estados en vivo" },
      { label: "📻 Activar ticker", prompt: "Quiero activar el ticker de estados en vivo" },
      { label: "Estado de mi suscripción", prompt: "¿Cuál es el estado de mi suscripción?" },
      { label: "🔓 Habilitar purga", prompt: "Quiero habilitar la sección de purga en configuración" },
    );
  }

  if (contexts.includes("HOY")) {
    contextual.push(
      { label: "Resumen judicial de hoy", prompt: "Resume la actividad judicial de hoy" },
      { label: "¿Hay alertas pendientes?", prompt: "¿Hay alertas pendientes que deba revisar?" },
    );
  }

  if (contexts.includes("SUPERVISOR")) {
    contextual.push(
      { label: "Auditoría de salud", prompt: "Hazme una auditoría de salud de la plataforma" },
      { label: "Proveedores degradados", prompt: "¿Hay proveedores degradados?" },
    );
  }

  return contextual;
}

interface AteniaWelcomeViewProps {
  contexts: BubbleContext[];
  onSelectPrompt: (prompt: string) => void;
  isFirstOpen?: boolean;
}

export function AteniaWelcomeView({ contexts, onSelectPrompt, isFirstOpen }: AteniaWelcomeViewProps) {
  const location = useLocation();
  const { isPlatformAdmin } = usePlatformAdmin();
  const contextualChips = getContextualChips(contexts, location.pathname);
  const capabilityGroups = buildCapabilityGroups(isPlatformAdmin);

  const handleChipClick = (chip: StarterChip) => {
    trackMascotEvent("chip_clicked", { label: chip.label });
    onSelectPrompt(chip.prompt);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Greeting */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            ¡Hola! Soy Atenia AI.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Puedo ayudarte a diagnosticar problemas, explicar funciones de la plataforma,
            gestionar configuraciones y asistirte con acciones avanzadas cuando lo solicites.
          </p>
        </div>
      </div>

      {/* Super admin notice */}
      {isPlatformAdmin && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <span className="text-[11px] text-amber-700 dark:text-amber-300">
            Tienes controles de plataforma en la consola de Super Administrador. Este asistente se enfoca en ayuda de usuario y organización.
          </span>
        </div>
      )}

      {/* Safety notice */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
        <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[11px] text-muted-foreground">
          Las acciones destructivas siempre requieren tu confirmación explícita.
          Este asistente gestiona tu cuenta y configuración de organización (con permiso).
        </span>
      </div>

      {/* Contextual chips (if any) */}
      {contextualChips.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-foreground">Sugerencias para esta página</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {contextualChips.map((chip) => (
              <button
                key={chip.prompt}
                onClick={() => handleChipClick(chip)}
                className="text-xs px-2.5 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Capability groups */}
      {capabilityGroups.map((group) => (
        <div key={group.title} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-primary">{group.icon}</span>
            <div>
              <span className="text-xs font-medium text-foreground">{group.title}</span>
              <span className="text-[10px] text-muted-foreground ml-2">{group.description}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.chips.map((chip) => (
              <button
                key={chip.prompt}
                onClick={() => handleChipClick(chip)}
                className="text-xs px-2.5 py-1.5 rounded-full border bg-background hover:bg-accent transition-colors text-left"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* First-time tour hint */}
      {isFirstOpen && (
        <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-1">
          <p className="text-xs font-medium text-primary">💡 Primera vez aquí</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Puedes escribir cualquier pregunta en el campo de abajo, o hacer clic en cualquier chip
            de arriba para iniciar una conversación. Atenia AI tiene acceso al contexto de tu organización
            y puede ejecutar acciones previa confirmación.
          </p>
        </div>
      )}
    </div>
  );
}
