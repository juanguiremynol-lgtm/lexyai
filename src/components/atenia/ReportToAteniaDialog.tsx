/**
 * ReportToAteniaDialog (B3)
 * 
 * User-facing dialog to report sync/data issues to Atenia AI.
 * Runs auto-diagnosis on the selected work item and submits a report.
 */

import { useState, useEffect } from 'react';
import { useOrganization } from '@/contexts/OrganizationContext';
import { supabase } from '@/integrations/supabase/client';
import { generateAutoDiagnosis, submitUserReport, type AutoDiagnosis } from '@/lib/services/atenia-ai-autonomous';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Bot, Send, Loader2, AlertTriangle, CheckCircle, Search } from 'lucide-react';
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
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-diagnose when dialog opens with a work item
  useEffect(() => {
    if (open && workItemId && !diagnosis) {
      runDiagnosis();
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

  const handleSubmit = async () => {
    if (!organization?.id || !description.trim()) return;

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      await submitUserReport({
        organizationId: organization.id,
        reporterUserId: user.id,
        workItemId: workItemId || undefined,
        reportType,
        description: description.trim(),
        autoDiagnosis: diagnosis || undefined,
      });

      toast.success('Reporte enviado a Atenia AI', {
        description: 'Tu reporte será analizado y se tomarán acciones correctivas si es necesario.',
      });
      setOpen(false);
      setDescription('');
      setDiagnosis(null);
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Reportar a Atenia AI
          </DialogTitle>
          <DialogDescription>
            Describe el problema y Atenia AI ejecutará un diagnóstico automático.
          </DialogDescription>
        </DialogHeader>

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
              <SelectItem value="sync_issue">Problema de sincronización</SelectItem>
              <SelectItem value="missing_data">Datos faltantes o incorrectos</SelectItem>
              <SelectItem value="stage_incorrect">Etapa procesal incorrecta</SelectItem>
              <SelectItem value="alert_missing">No recibí alerta esperada</SelectItem>
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
                  <span className="text-sm font-medium">Diagnóstico Automático</span>
                  {isDiagnosing && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                {diagnosis ? (
                  <div className="text-xs space-y-1 whitespace-pre-line text-muted-foreground">
                    {diagnosis.diagnosis_summary.split('\n').map((line, i) => (
                      <div key={i} className="flex items-start gap-1">
                        {line.startsWith('✅') && <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />}
                        {(line.startsWith('⚠️') || line.startsWith('🔴') || line.startsWith('🟡')) && (
                          <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                        )}
                        <span>{line.replace(/^[✅⚠️🔴🟡]\s*/, '')}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex gap-3 text-[10px]">
                      <span>Actuaciones: {diagnosis.actuaciones_count}</span>
                      <span>Estados: {diagnosis.publicaciones_count}</span>
                      <span>Trazas: {diagnosis.sync_traces_recent.length}</span>
                    </div>
                  </div>
                ) : !isDiagnosing ? (
                  <Button variant="ghost" size="sm" onClick={runDiagnosis} className="text-xs">
                    Ejecutar diagnóstico
                  </Button>
                ) : null}
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
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar reporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
