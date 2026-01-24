import { CpacaPipeline } from "@/components/cpaca";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Scale, Info } from "lucide-react";

export default function CpacaPage() {
  return (
    <div className="space-y-6">
      {/* Header - stays fixed, no horizontal scroll */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Scale className="h-8 w-8 text-indigo-500 flex-shrink-0" />
            <span>CPACA – Contencioso Administrativo</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            Gestión de procesos ordinarios contencioso administrativos
          </p>
        </div>
      </div>

      {/* Info alert */}
      <Alert className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20">
        <Info className="h-4 w-4 text-indigo-500" />
        <AlertDescription className="text-indigo-700 dark:text-indigo-300">
          <strong>Cálculo de términos CPACA (Art. 199):</strong> La notificación electrónica 
          se entiende surtida al cabo de 2 días hábiles siguientes al envío. Los términos 
          empiezan a correr a partir del día hábil siguiente.
        </AlertDescription>
      </Alert>

      {/* Pipeline */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Tablero Kanban</CardTitle>
          <CardDescription>
            Arrastre los procesos entre columnas para actualizar su estado. 
            Pase el cursor sobre los encabezados para ver descripción y fechas clave.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CpacaPipeline />
        </CardContent>
      </Card>
    </div>
  );
}
