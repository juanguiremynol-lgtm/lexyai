import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Target, FileText, Building2, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilingGoalsCardProps {
  radicado: string | null;
  courtName: string | null;
  expedienteUrl: string | null;
}

export function FilingGoalsCard({ radicado, courtName, expedienteUrl }: FilingGoalsCardProps) {
  const goals = [
    {
      id: "radicado",
      label: "Número de Radicado",
      description: "23 dígitos del proceso",
      completed: !!radicado,
      value: radicado,
      icon: FileText,
    },
    {
      id: "court",
      label: "Juzgado / Autoridad",
      description: "Autoridad de conocimiento",
      completed: !!courtName,
      value: courtName,
      icon: Building2,
    },
    {
      id: "expediente",
      label: "Expediente Electrónico",
      description: "URL de acceso al expediente",
      completed: !!expedienteUrl,
      value: expedienteUrl,
      icon: Link2,
    },
  ];

  const completedCount = goals.filter((g) => g.completed).length;
  const allComplete = completedCount === goals.length;

  return (
    <Card className={cn(
      "transition-colors",
      allComplete && "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5" />
            Objetivos de la Radicación
          </CardTitle>
          <Badge variant={allComplete ? "default" : "secondary"}>
            {completedCount} / {goals.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {goals.map((goal) => (
          <div
            key={goal.id}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border transition-colors",
              goal.completed
                ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                : "bg-muted/50 border-dashed"
            )}
          >
            {goal.completed ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <goal.icon className="h-4 w-4 text-muted-foreground" />
                <span className={cn(
                  "font-medium",
                  goal.completed && "text-green-700 dark:text-green-300"
                )}>
                  {goal.label}
                </span>
              </div>
              {goal.completed ? (
                <p className="text-sm text-muted-foreground mt-1 truncate">
                  {goal.id === "expediente" ? (
                    <a
                      href={goal.value || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {goal.value}
                    </a>
                  ) : (
                    goal.value
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  {goal.description}
                </p>
              )}
            </div>
          </div>
        ))}

        {allComplete && (
          <div className="text-center py-2">
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              ✓ Todos los objetivos completados
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
