/**
 * AteniaHealthAudit — Platform health audit powered by Gemini
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Loader2, RefreshCw } from "lucide-react";
import { buildPlatformHealthPrompt, callGeminiViaEdge } from "@/lib/services/atenia-ai-engine";
import { toast } from "sonner";

interface Props {
  organizationId: string;
  geminiEnabled: boolean;
}

export function AteniaHealthAudit({ organizationId, geminiEnabled }: Props) {
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<string | null>(null);

  const runAudit = async () => {
    if (!geminiEnabled) {
      toast.error('Gemini está desactivado en la configuración de Atenia AI.');
      return;
    }

    setIsAuditing(true);
    setAuditResult(null);

    try {
      const prompt = await buildPlatformHealthPrompt(organizationId);
      const result = await callGeminiViaEdge(prompt);
      setAuditResult(result);
    } catch (err: any) {
      toast.error(`Error al generar auditoría: ${err?.message || 'desconocido'}`);
      setAuditResult(`Error: ${err?.message || 'No se pudo conectar con el servicio de IA'}`);
    } finally {
      setIsAuditing(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            Salud de la Plataforma (Auditoría AI)
          </CardTitle>
          <Button
            size="sm"
            onClick={runAudit}
            disabled={isAuditing || !geminiEnabled}
            className="gap-1"
          >
            {isAuditing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {auditResult ? 'Regenerar' : 'Generar Auditoría'}
          </Button>
        </div>
        {!geminiEnabled && (
          <p className="text-xs text-destructive mt-1">
            ⛔ Gemini está desactivado. Active la integración en Configuración para usar esta función.
          </p>
        )}
      </CardHeader>
      {auditResult && (
        <CardContent>
          <div className="text-sm whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-4 max-h-[600px] overflow-y-auto">
            {auditResult}
          </div>
        </CardContent>
      )}
      {!auditResult && !isAuditing && geminiEnabled && (
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Presiona "Generar Auditoría" para que Atenia AI analice el estado completo de la plataforma.
          </p>
        </CardContent>
      )}
      {isAuditing && (
        <CardContent>
          <div className="flex flex-col items-center gap-2 py-6">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analizando datos de la plataforma...</p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
