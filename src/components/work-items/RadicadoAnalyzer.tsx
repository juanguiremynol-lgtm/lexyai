/**
 * RadicadoAnalyzer — Displays parsed radicado blocks with labels + validation status
 */

import { parseRadicadoBlocks, formatRadicadoWithLabels, normalizeRadicadoInput } from "@/lib/radicado-utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface RadicadoAnalyzerProps {
  radicado: string | null | undefined;
  className?: string;
  compact?: boolean;
}

export function RadicadoAnalyzer({ radicado, className, compact = false }: RadicadoAnalyzerProps) {
  if (!radicado) return null;

  const normalized = normalizeRadicadoInput(radicado);
  const parsed = parseRadicadoBlocks(normalized);
  const blocks = formatRadicadoWithLabels(normalized);

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 flex-wrap", className)}>
        {parsed.valid ? (
          <Badge variant="outline" className="text-xs gap-1 border-emerald-500/50 text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            Radicado válido
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs gap-1 border-destructive/50 text-destructive">
            <XCircle className="h-3 w-3" />
            Radicado inválido
          </Badge>
        )}
        {parsed.warnings.map((w, i) => (
          <Badge key={i} variant="outline" className="text-xs gap-1 border-amber-500/50 text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            {w}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <Card className={cn("border-muted", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Hash className="h-4 w-4 text-muted-foreground" />
          Análisis del Radicado
          {parsed.valid ? (
            <Badge variant="outline" className="text-xs gap-1 border-emerald-500/50 text-emerald-600 ml-auto">
              <CheckCircle2 className="h-3 w-3" />
              Válido
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 border-destructive/50 text-destructive ml-auto">
              <XCircle className="h-3 w-3" />
              Inválido
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Block grid */}
        {blocks.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {blocks.map((b) => (
              <div key={b.code} className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{b.label}</p>
                <p className="font-mono text-sm font-semibold">{b.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Errors */}
        {parsed.errors.length > 0 && (
          <div className="space-y-1">
            {parsed.errors.map((e, i) => (
              <p key={i} className="text-xs text-destructive flex items-center gap-1">
                <XCircle className="h-3 w-3 shrink-0" />
                {e}
              </p>
            ))}
          </div>
        )}

        {/* Warnings */}
        {parsed.warnings.length > 0 && (
          <div className="space-y-1">
            {parsed.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {w}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
