import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale, FileText, Building2, ShieldAlert, Lock, Landmark, Briefcase } from "lucide-react";

export type FilingCategory = "CGP" | "LABORAL" | "TUTELA" | "HABEAS_CORPUS" | "PETICION" | "ADMINISTRATIVO" | "CPACA";

interface NewFilingTypeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectType: (type: FilingCategory) => void;
}

const FILING_CATEGORIES = [
  {
    type: "CGP" as FilingCategory,
    title: "Demanda CGP",
    description: "Proceso judicial ordinario bajo el Código General del Proceso",
    icon: Scale,
    examples: "Declarativo, ejecutivo, verbal sumario, etc.",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10 hover:bg-blue-500/20",
  },
  {
    type: "LABORAL" as FilingCategory,
    title: "Proceso Laboral",
    description: "Proceso judicial ante la jurisdicción ordinaria laboral",
    icon: Briefcase,
    examples: "Ordinario laboral, ejecutivo laboral, fuero sindical",
    color: "text-rose-500",
    bgColor: "bg-rose-500/10 hover:bg-rose-500/20",
  },
  {
    type: "CPACA" as FilingCategory,
    title: "Proceso CPACA",
    description: "Proceso contencioso administrativo ante la jurisdicción",
    icon: Landmark,
    examples: "Nulidad, reparación directa, controversias contractuales",
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10 hover:bg-indigo-500/20",
  },
  {
    type: "TUTELA" as FilingCategory,
    title: "Acción de Tutela",
    description: "Protección de derechos fundamentales",
    icon: ShieldAlert,
    examples: "Salud, educación, debido proceso, vivienda",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10 hover:bg-amber-500/20",
  },
  {
    type: "HABEAS_CORPUS" as FilingCategory,
    title: "Habeas Corpus",
    description: "Protección de la libertad personal (Art. 30 Constitución)",
    icon: Lock,
    examples: "Detención ilegal, prolongación indebida, captura irregular",
    color: "text-red-500",
    bgColor: "bg-red-500/10 hover:bg-red-500/20",
  },
  {
    type: "PETICION" as FilingCategory,
    title: "Derecho de Petición",
    description: "Solicitudes a entidades públicas o privadas",
    icon: FileText,
    examples: "Petición de información, queja, consulta, reclamo",
    color: "text-green-500",
    bgColor: "bg-green-500/10 hover:bg-green-500/20",
  },
  {
    type: "ADMINISTRATIVO" as FilingCategory,
    title: "Proceso Administrativo",
    description: "Actuaciones ante autoridades administrativas",
    icon: Building2,
    examples: "Policivo, sancionatorio, tránsito, disciplinario, SIC",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10 hover:bg-purple-500/20",
  },
];

export function NewFilingTypeSelector({
  open,
  onOpenChange,
  onSelectType,
}: NewFilingTypeSelectorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[750px]">
        <DialogHeader>
          <DialogTitle>Nueva Radicación</DialogTitle>
          <DialogDescription>
            Selecciona el tipo de actuación que deseas crear
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          {FILING_CATEGORIES.map((category) => {
            const Icon = category.icon;
            return (
              <Card
                key={category.type}
                className={`cursor-pointer transition-all border-2 border-transparent hover:border-primary/50 ${category.bgColor}`}
                onClick={() => onSelectType(category.type)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-background ${category.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-base">{category.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <CardDescription className="text-sm">
                    {category.description}
                  </CardDescription>
                  <p className="text-xs text-muted-foreground">
                    Ej: {category.examples}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

