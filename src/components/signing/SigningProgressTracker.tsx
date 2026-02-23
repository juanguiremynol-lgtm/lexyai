/**
 * SigningProgressTracker — Shared step progress indicator for all signing flows.
 * Shows completed steps with timestamps and current step highlighting.
 * Used by LawyerSigningFlow, SigningPage, and document detail/resume UIs.
 */

import { CheckCircle2, UserCheck, Mail, FileText, Shield, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export type SigningStepKey = "identity" | "otp" | "review" | "sign" | "done";

export interface SigningStepState {
  key: SigningStepKey;
  label: string;
  completedAt?: string | null;
}

interface SigningProgressTrackerProps {
  currentStep: SigningStepKey;
  steps?: SigningStepState[];
  /** Compact mode for inline display in document cards */
  compact?: boolean;
  /** Show timestamps for completed steps */
  showTimestamps?: boolean;
  className?: string;
}

const DEFAULT_STEPS: SigningStepState[] = [
  { key: "identity", label: "Identidad" },
  { key: "otp", label: "Verificación" },
  { key: "review", label: "Revisión" },
  { key: "sign", label: "Firma" },
];

const STEP_ICONS: Record<SigningStepKey, typeof UserCheck> = {
  identity: UserCheck,
  otp: Mail,
  review: FileText,
  sign: Shield,
  done: CheckCircle2,
};

const STEP_ORDER: SigningStepKey[] = ["identity", "otp", "review", "sign", "done"];

export function SigningProgressTracker({
  currentStep,
  steps = DEFAULT_STEPS,
  compact = false,
  showTimestamps = false,
  className,
}: SigningProgressTrackerProps) {
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {steps.map((s, i) => {
          const stepIdx = STEP_ORDER.indexOf(s.key);
          const isDone = stepIdx < currentIdx || currentStep === "done";
          const isActive = s.key === currentStep && currentStep !== "done";
          return (
            <div key={s.key} className="flex items-center gap-1">
              <div
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  isDone && "bg-emerald-500",
                  isActive && "bg-primary animate-pulse",
                  !isDone && !isActive && "bg-muted-foreground/30"
                )}
                title={`${s.label}${isDone ? " ✓" : isActive ? " (actual)" : ""}`}
              />
              {i < steps.length - 1 && (
                <div className={cn("h-px w-2", isDone ? "bg-emerald-500/50" : "bg-muted-foreground/20")} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1.5 sm:gap-2 justify-start sm:justify-center overflow-x-auto pb-1 scrollbar-hide", className)}>
      {steps.map((s, i) => {
        const Icon = STEP_ICONS[s.key] || FileText;
        const stepIdx = STEP_ORDER.indexOf(s.key);
        const isDone = stepIdx < currentIdx || currentStep === "done";
        const isActive = s.key === currentStep && currentStep !== "done";

        return (
          <div key={s.key} className="flex items-center gap-1 sm:gap-2 shrink-0">
            <div
              className={cn(
                "flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-colors",
                isActive && "bg-primary text-primary-foreground",
                isDone && "bg-primary/20 text-primary",
                !isActive && !isDone && "bg-muted text-muted-foreground"
              )}
            >
              {isDone ? (
                <CheckCircle2 className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
              ) : isActive ? (
                <Loader2 className="h-3 sm:h-3.5 w-3 sm:w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3 sm:h-3.5 w-3 sm:w-3.5" />
              )}
              <span className="hidden xs:inline sm:inline">{s.label}</span>
            </div>
            {showTimestamps && isDone && s.completedAt && (
              <span className="text-[9px] text-muted-foreground hidden md:inline">
                {format(new Date(s.completedAt), "HH:mm", { locale: es })}
              </span>
            )}
            {i < steps.length - 1 && (
              <div className={cn(
                "h-px w-3 sm:w-6 shrink-0",
                isDone ? "bg-primary/40" : "bg-muted-foreground/20"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compute the current signing step from document_signatures row data.
 * Used for resume logic — determines where to restart.
 */
export function resolveSigningStep(signature: {
  identity_confirmed_at?: string | null;
  otp_verified_at?: string | null;
  signed_at?: string | null;
  status?: string;
}): SigningStepKey {
  if (signature.signed_at || signature.status === "signed") return "done";
  if (signature.otp_verified_at) return "review";
  if (signature.identity_confirmed_at) return "otp";
  return "identity";
}

/**
 * Build step states with timestamps from a document_signatures row.
 */
export function buildSigningSteps(signature: {
  identity_confirmed_at?: string | null;
  otp_verified_at?: string | null;
  signed_at?: string | null;
}): SigningStepState[] {
  return [
    { key: "identity", label: "Identidad", completedAt: signature.identity_confirmed_at },
    { key: "otp", label: "Verificación", completedAt: signature.otp_verified_at },
    { key: "review", label: "Revisión", completedAt: null },
    { key: "sign", label: "Firma", completedAt: signature.signed_at },
  ];
}
