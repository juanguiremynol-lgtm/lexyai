/**
 * ReportToAteniaDialog (B3 — Expanded)
 *
 * User-facing dialog to report sync/data issues to Atenia AI.
 * Runs auto-diagnosis, optionally escalates to Gemini, generates
 * a copyable technical report, and submits to atenia_ai_user_reports.
 */

import { useState, useEffect } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import {
  generateAutoDiagnosis,
  submitUserReport,
  type AutoDiagnosis,
} from '@/lib/services/atenia-ai-autonomous';
import { callGeminiViaEdge } from '@/lib/services/atenia-ai-engine';
import { buildAteniaAiTechnicalReport } from '@/lib/services/atenia-ai-technical-report';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Bot,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Search,
  ClipboardCopy,
  Brain,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  workItemId?: string;
  workItemRadicado?: string;
  trigger?: React.ReactNode;
}

export function ReportToAteniaDialog({ workItemId, workItemRadicado, trigger }: Props) {
  const { organization } = useOrganization();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [reportType, setReportType] = useState('sync_issue');
  const [diagnosis, setDiagnosis] = useState<AutoDiagnosis | null>(null);
  const [geminiAnalysis, setGeminiAnalysis] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Auto-diagnose when dialog opens with a work item
  useEffect(() => {
    if (open && workItemId && !diagnosis) {
      runDiagnosis();
    }
    if (!open) {
      // Reset on close
      setDiagnosis(null);
      setGeminiAnalysis(null);
      setSubmitted(false);
    }
  }, [open, workItemId]);

  const runDiagnosis = async () => {
    if (!workItemId) return;
    setIsDiagnosing(true);
    try {
      const result = await generateAutoDiagnosis(workItemId);
      setDiagnosis(result);
    } catch (err) {
      console.error('[ReportToAtenia] Diagnosis failed:', err);
    } finally {
      setIsDiagnosing(false);
    }
  };

  const escalateToGemini = async () => {
    if (!diagnosis) return;
    setIsEscalating(true);
    try {
      const prompt = `Eres Atenia AI. Un usuario reportó un problema con el radicado ${diagnosis.radicado || 'desconocido'}.

CONTEXTO:
- Tipo: ${diagnosis.workflow_type}
- Última sync: ${diagnosis.last_synced_at || 'NUNCA'}
- Actuaciones: ${diagnosis.actuaciones_count}
- Estados: ${diagnosis.publicaciones_count}
- Errores recientes: ${diagnosis.sync_traces_recent.filter(t => !t.success).map(t => t.error_code).join(', ') || 'ninguno'}

DESCRIPCIÓN DEL USUARIO:
${description || 'Sin descripción'}

DIAGNÓSTICO AUTOMÁTICO:
${diagnosis.diagnosis_summary}

Genera un análisis breve (máximo 3 oraciones) y una recomendación.`;

      const result = await callGeminiViaEdge(prompt);
      setGeminiAnalysis(result);
    } catch {
      setGeminiAnalysis('No se pudo conectar con Gemini.');
    } finally {
      setIsEscalating(false);
    }
  };

  const handleCopyReport = async () => {
    if (!diagnosis) return;
    const report = buildAteniaAiTechnicalReport(
      diagnosis,
      geminiAnalysis,
      description || undefined,
    );
    try {
      await navigator.clipboard.writeText(report);
      toast.success('Diagnóstico técnico copiado al portapapeles');
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  const handleSubmit = async () => {
    if (!organization?.id || !description.trim()) return;

    setIsSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      await submitUserReport({
        organizationId: organization.id,
        reporterUserId: user.id,
        workItemId: workItemId || undefined,
        reportType,
        description: description.trim(),
        autoDiagnosis: diagnosis || undefined,
      });

      // If we have a Gemini analysis, update the report with it
      // (the report was just created, but we can update via the log)

      setSubmitted(true);
      toast.success('Reporte enviado a Atenia AI', {
        description:
          'Tu reporte será analizado y se tomarán acciones correctivas si es necesario.',
      });
    } catch (err: any) {
      toast.error('Error al enviar reporte: ' + (err.message || 'Error desconocido'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <Bot className="h-4 w-4" />
            Reportar a Atenia AI
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Reportar a Atenia AI
          </DialogTitle>
          <DialogDescription>
            Describe el problema y Atenia AI ejecutará un diagnóstico automático.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
            <p className="text-sm font-medium">Reporte enviado exitosamente</p>
            <p className="text-xs text-muted-foreground">
              Tu reporte será analizado por Atenia AI. Si se requiere acción
              correctiva, se ejecutará automáticamente.
            </p>
            {diagnosis && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyReport}
                className="gap-2"
              >
                <ClipboardCopy className="h-3.5 w-3.5" />
                Copiar diagnóstico técnico
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {/* Work item context */}
              {workItemRadicado && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="font-mono text-xs">
                    {workItemRadicado}
                  </Badge>
                </div>
              )}

              {/* Report type */}
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sync_issue">
                    Problema de sincronización
                  </SelectItem>
                  <SelectItem value="missing_data">
                    Datos faltantes o incorrectos
                  </SelectItem>
                  <SelectItem value="stage_incorrect">
                    Etapa procesal incorrecta
                  </SelectItem>
                  <SelectItem value="alert_missing">
                    No recibí alerta esperada
                  </SelectItem>
                  <SelectItem value="other">Otro</SelectItem>
                </SelectContent>
              </Select>

              {/* Description */}
              <Textarea
                placeholder="Describe el problema que estás experimentando..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />

              {/* Auto-diagnosis */}
              {workItemId && (
                <Card className="border-dashed">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Diagnóstico Automático
                      </span>
                      {isDiagnosing && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                    </div>
                    {diagnosis ? (
                      <div className="text-xs space-y-1 whitespace-pre-line text-muted-foreground">
                        {diagnosis.diagnosis_summary
                          .split('\n')
                          .map((line, i) => (
                            <div key={i} className="flex items-start gap-1">
                              {line.startsWith('✅') && (
                                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                              )}
                              {(line.startsWith('⚠️') ||
                                line.startsWith('🔴') ||
                                line.startsWith('🟡')) && (
                                <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                              )}
                              <span>
                                {line.replace(/^[✅⚠️🔴🟡]\s*/, '')}
                              </span>
                            </div>
                          ))}
                        <div className="mt-2 flex gap-3 text-[10px]">
                          <span>
                            Actuaciones: {diagnosis.actuaciones_count}
                          </span>
                          <span>
                            Estados: {diagnosis.publicaciones_count}
                          </span>
                          <span>
                            Trazas: {diagnosis.sync_traces_recent.length}
                          </span>
                        </div>

                        {/* Escalate to Gemini */}
                        <div className="mt-3 flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={escalateToGemini}
                            disabled={isEscalating}
                            className="text-xs gap-1 h-7"
                          >
                            {isEscalating ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Brain className="h-3 w-3" />
                            )}
                            Análisis AI
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopyReport}
                            className="text-xs gap-1 h-7"
                          >
                            <ClipboardCopy className="h-3 w-3" />
                            Copiar diagnóstico
                          </Button>
                        </div>
                      </div>
                    ) : !isDiagnosing ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={runDiagnosis}
                        className="text-xs"
                      >
                        Ejecutar diagnóstico
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              )}

              {/* Gemini Analysis Result */}
              {geminiAnalysis && (
                <Card className="border-primary/20">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">
                        Análisis de Atenia AI
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {geminiAnalysis}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !description.trim()}
                className="gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Enviar reporte
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
