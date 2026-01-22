import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Gavel } from "lucide-react";
import type { WorkItem } from "@/types/work-item";
import { getStageLabel } from "@/lib/workflow-constants";

interface Props { workItem: WorkItem; }

export default function TutelaDetailModule({ workItem }: Props) {
  const navigate = useNavigate();
  const stageLabel = getStageLabel("TUTELA", workItem.stage);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Gavel className="h-5 w-5 text-purple-500" />
            <h1 className="text-2xl font-serif font-bold">{workItem.title || "Tutela"}</h1>
            <Badge variant="secondary">{stageLabel}</Badge>
          </div>
          <p className="text-muted-foreground">{workItem.authority_name}</p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Información</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div><p className="text-sm text-muted-foreground">Radicado</p><p className="font-mono">{workItem.radicado || "Sin radicado"}</p></div>
          <div><p className="text-sm text-muted-foreground">Juzgado</p><p>{workItem.authority_name || "Sin juzgado"}</p></div>
          <div><p className="text-sm text-muted-foreground">Demandantes</p><p>{workItem.demandantes || "N/A"}</p></div>
          <div><p className="text-sm text-muted-foreground">Demandados</p><p>{workItem.demandados || "N/A"}</p></div>
        </CardContent>
      </Card>
    </div>
  );
}
