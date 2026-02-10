/**
 * WizardExplanation — Right-side contextual panel for each wizard step.
 */

import { Info, AlertTriangle, Lightbulb, Shield } from "lucide-react";

interface WizardExplanationProps {
  title: string;
  whatItDoes: string;
  whyItMatters: string;
  commonMistakes?: string[];
  warnings?: string[];
}

export function WizardExplanation({ title, whatItDoes, whyItMatters, commonMistakes, warnings }: WizardExplanationProps) {
  return (
    <div className="space-y-4 bg-muted/30 border border-border/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Info className="h-4 w-4 text-primary" />
        {title}
      </h3>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Qué hace</p>
        <p className="text-sm text-foreground/80">{whatItDoes}</p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Lightbulb className="h-3 w-3" /> Por qué importa
        </p>
        <p className="text-sm text-foreground/80">{whyItMatters}</p>
      </div>

      {commonMistakes && commonMistakes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-destructive/80 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Errores comunes
          </p>
          <ul className="space-y-1">
            {commonMistakes.map((m, i) => (
              <li key={i} className="text-xs text-destructive/70 flex items-start gap-1.5">
                <span className="text-destructive/50 mt-0.5">•</span>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <div className="space-y-1.5 bg-destructive/5 border border-destructive/20 rounded-lg p-3">
          <p className="text-xs font-medium text-destructive flex items-center gap-1">
            <Shield className="h-3 w-3" /> Advertencias
          </p>
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-destructive/80">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
