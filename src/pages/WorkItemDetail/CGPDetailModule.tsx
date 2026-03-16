/**
 * CGP Detail Module - Renders CGP workflow details
 */
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Scale, FileText } from "lucide-react";
import type { WorkItem } from "@/types/work-item";
import { getStageLabel } from "@/lib/workflow-constants";
import NovedadesCpnuPanel from "@/components/work-items/NovedadesCpnuPanel";

interface Props {
  workItem: WorkItem;
}

export default function CGPDetailModule({ workItem }: Props) {
  const navigate = useNavigate();
  const isProcessPhase = workItem.cgp_phase === "PROCESS";
  const phaseLabel = isProcessPhase ? "PROCESO" : "RADICACIÓN";
  const stageLabel = getStageLabel("CGP", workItem.stage, workItem.cgp_phase || undefined);

  return (
    <div className="space-y-6">
      {/* Phase Banner */}
      <Card className={`border-2 ${isProcessPhase ? "border-emerald-200 dark:border-emerald-800" : "border-amber-200 dark:border-amber-800"}`}>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge className={isProcessPhase ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"}>
                {isProcessPhase ? <Scale className="h-3 w-3 mr-1" /> : <FileText className="h-3 w-3 mr-1" />}
                {phaseLabel}
              </Badge>
              {workItem.radicado && (
                <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                  {workItem.radicado}
                </code>
              )}
              {workItem.authority_name && (
                <span className="text-sm text-muted-foreground">
                  {workItem.authority_name}
                </span>
              )}
            </div>
            <Badge variant="outline">{stageLabel}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-serif font-bold">
            {workItem.clients?.name || workItem.title || "Caso CGP"}
          </h1>
          <p className="text-muted-foreground">
            {workItem.demandantes} vs {workItem.demandados}
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información del Caso</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Radicado</p>
                  <p className="font-mono">{workItem.radicado || "Sin radicado"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Juzgado</p>
                  <p>{workItem.authority_name || "Sin juzgado"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Ciudad</p>
                  <p>{workItem.authority_city || "Sin ciudad"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Departamento</p>
                  <p>{workItem.authority_department || "Sin departamento"}</p>
                </div>
              </div>
              {workItem.description && (
                <div>
                  <p className="text-sm text-muted-foreground">Descripción</p>
                  <p>{workItem.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Estado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-sm text-muted-foreground">Fase</p>
                <p className="font-medium">{phaseLabel}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Etapa</p>
                <p className="font-medium">{stageLabel}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Actuaciones</p>
                <p className="font-medium">{workItem.total_actuaciones || 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
