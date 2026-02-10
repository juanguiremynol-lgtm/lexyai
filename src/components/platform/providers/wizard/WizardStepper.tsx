/**
 * WizardStepper — Progress indicator with step labels.
 */

import { WIZARD_STEPS } from "./WizardTypes";
import { Check, Sparkles, Puzzle, Shield, Server, ShieldCheck, ArrowLeftRight, Route, Zap, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, React.ElementType> = {
  Sparkles, Puzzle, Shield, Server, ShieldCheck, ArrowLeftRight, Route, Zap, CheckCircle2,
};

interface WizardStepperProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export function WizardStepper({ currentStep, onStepClick }: WizardStepperProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {WIZARD_STEPS.map((step, idx) => {
        const Icon = ICON_MAP[step.icon] || Sparkles;
        const isComplete = idx < currentStep;
        const isCurrent = idx === currentStep;
        const isClickable = idx < currentStep && onStepClick;

        return (
          <div key={step.key} className="flex items-center">
            <button
              type="button"
              onClick={() => isClickable && onStepClick(idx)}
              disabled={!isClickable}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                isCurrent && "bg-primary/10 text-primary border border-primary/30 shadow-sm",
                isComplete && "text-primary hover:bg-primary/10 cursor-pointer",
                !isCurrent && !isComplete && "text-muted-foreground/50",
              )}
            >
              <span className={cn(
                "flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold shrink-0",
                isCurrent && "bg-primary text-primary-foreground",
                isComplete && "bg-primary/20 text-primary",
                !isCurrent && !isComplete && "bg-muted text-muted-foreground/50",
              )}>
                {isComplete ? <Check className="h-3 w-3" /> : idx}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {idx < WIZARD_STEPS.length - 1 && (
              <div className={cn(
                "w-4 h-px mx-0.5",
                isComplete ? "bg-primary/40" : "bg-border/50",
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
