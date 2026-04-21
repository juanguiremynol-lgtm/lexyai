import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Scale, Send, Gavel, Building2, Landmark, ChevronRight, Info, Briefcase, Shield } from "lucide-react";
import {
  type WorkflowType,
  type CGPPhase,
  WORKFLOW_TYPES,
  WORKFLOW_TYPES_ORDER,
  getStagesForWorkflow,
  getStageOrderForWorkflow,
  getDefaultStage,
} from "@/lib/workflow-constants";
import type { WorkflowClassification } from "@/types/work-item";

interface WorkflowClassificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClassify: (classification: WorkflowClassification) => void;
  title?: string;
  description?: string;
  initialWorkflowType?: WorkflowType;
  showCGPPhaseStep?: boolean;
}

const WORKFLOW_ICONS: Record<WorkflowType, React.ReactNode> = {
  CGP: <Scale className="h-5 w-5" />,
  PETICION: <Send className="h-5 w-5" />,
  TUTELA: <Gavel className="h-5 w-5" />,
  GOV_PROCEDURE: <Building2 className="h-5 w-5" />,
  CPACA: <Landmark className="h-5 w-5" />,
  LABORAL: <Briefcase className="h-5 w-5" />,
  PENAL_906: <Shield className="h-5 w-5" />,
  GENERIC: <FileText className="h-5 w-5" />,
};

export function WorkflowClassificationDialog({
  open,
  onOpenChange,
  onClassify,
  title = "Clasificar Asunto",
  description = "Selecciona el tipo de proceso y la etapa inicial para este asunto.",
  initialWorkflowType,
  showCGPPhaseStep = true,
}: WorkflowClassificationDialogProps) {
  const [step, setStep] = useState<'workflow' | 'cgp_phase' | 'stage'>('workflow');
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType | null>(initialWorkflowType || null);
  const [selectedCGPPhase, setSelectedCGPPhase] = useState<CGPPhase>('FILING');
  const [selectedStage, setSelectedStage] = useState<string>('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep('workflow');
      setSelectedWorkflow(initialWorkflowType || null);
      setSelectedCGPPhase('FILING');
      setSelectedStage('');
    }
  }, [open, initialWorkflowType]);

  // Auto-advance when workflow is selected (if not CGP or CGP phase step disabled)
  useEffect(() => {
    if (selectedWorkflow) {
      if (selectedWorkflow === 'CGP' && showCGPPhaseStep) {
        // CGP needs phase selection
        if (step === 'workflow') {
          setStep('cgp_phase');
        }
      } else {
        // Other workflows go straight to stage
        if (step === 'workflow') {
          setStep('stage');
          setSelectedStage(getDefaultStage(selectedWorkflow));
        }
      }
    }
  }, [selectedWorkflow, step, showCGPPhaseStep]);

  // Update stage when CGP phase changes
  useEffect(() => {
    if (selectedWorkflow === 'CGP' && step === 'stage') {
      setSelectedStage(getDefaultStage('CGP', selectedCGPPhase));
    }
  }, [selectedCGPPhase, selectedWorkflow, step]);

  const handleWorkflowSelect = (workflow: WorkflowType) => {
    setSelectedWorkflow(workflow);
  };

  const handleCGPPhaseSelect = (phase: CGPPhase) => {
    setSelectedCGPPhase(phase);
    setStep('stage');
    setSelectedStage(getDefaultStage('CGP', phase));
  };

  const handleStageSelect = (stage: string) => {
    setSelectedStage(stage);
  };

  const handleConfirm = () => {
    if (!selectedWorkflow || !selectedStage) return;

    const classification: WorkflowClassification = {
      workflow_type: selectedWorkflow,
      stage: selectedStage,
    };

    if (selectedWorkflow === 'CGP') {
      classification.cgp_phase = selectedCGPPhase;
    }

    onClassify(classification);
    onOpenChange(false);
  };

  const handleBack = () => {
    if (step === 'stage') {
      if (selectedWorkflow === 'CGP' && showCGPPhaseStep) {
        setStep('cgp_phase');
      } else {
        setStep('workflow');
        setSelectedWorkflow(null);
      }
    } else if (step === 'cgp_phase') {
      setStep('workflow');
      setSelectedWorkflow(null);
    }
  };

  const stages = selectedWorkflow 
    ? getStagesForWorkflow(selectedWorkflow, selectedWorkflow === 'CGP' ? selectedCGPPhase : undefined)
    : {};
  const stageOrder = selectedWorkflow 
    ? getStageOrderForWorkflow(selectedWorkflow, selectedWorkflow === 'CGP' ? selectedCGPPhase : undefined)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Step 1: Select Workflow Type */}
          {step === 'workflow' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Tipo de Proceso</Label>
              <div className="grid gap-2">
                {WORKFLOW_TYPES_ORDER.map((type) => {
                  const config = WORKFLOW_TYPES[type];
                  const isSelected = selectedWorkflow === type;
                  
                  return (
                    <button
                      key={type}
                      onClick={() => handleWorkflowSelect(type)}
                      className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50 hover:bg-muted/50'
                      }`}
                    >
                      <div className={`p-2 rounded-md bg-${config.color}-500/10 text-${config.color}-600`}>
                        {WORKFLOW_ICONS[type]}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{config.label}</p>
                        <p className="text-xs text-muted-foreground">{config.description}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 2 (CGP only): Select Phase */}
          {step === 'cgp_phase' && selectedWorkflow === 'CGP' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700">
                  <Scale className="h-3 w-3 mr-1" />
                  CGP
                </Badge>
              </div>
              
              <Label className="text-sm font-medium">¿Este asunto ya tiene Auto Admisorio?</Label>
              
              <div className="bg-muted/50 p-3 rounded-lg flex items-start gap-2 text-sm">
                <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-muted-foreground">
                  Si la demanda ha sido admitida por el juzgado (tiene auto admisorio), 
                  selecciona "Sí, es Proceso". De lo contrario, selecciona "No, es Radicación".
                </p>
              </div>

              <RadioGroup
                value={selectedCGPPhase}
                onValueChange={(v) => handleCGPPhaseSelect(v as CGPPhase)}
                className="grid gap-3"
              >
                <div
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedCGPPhase === 'FILING'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => handleCGPPhaseSelect('FILING')}
                >
                  <RadioGroupItem value="FILING" id="phase-filing" />
                  <div className="flex-1">
                    <Label htmlFor="phase-filing" className="font-medium cursor-pointer">
                      No, es Radicación
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      La demanda fue radicada pero aún no ha sido admitida
                    </p>
                  </div>
                </div>
                
                <div
                  className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedCGPPhase === 'PROCESS'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => handleCGPPhaseSelect('PROCESS')}
                >
                  <RadioGroupItem value="PROCESS" id="phase-process" />
                  <div className="flex-1">
                    <Label htmlFor="phase-process" className="font-medium cursor-pointer">
                      Sí, es Proceso
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      La demanda ya tiene auto admisorio y es un proceso activo
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Step 3: Select Stage */}
          {step === 'stage' && selectedWorkflow && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={`bg-${WORKFLOW_TYPES[selectedWorkflow].color}-500/10`}>
                  {WORKFLOW_ICONS[selectedWorkflow]}
                  <span className="ml-1">{WORKFLOW_TYPES[selectedWorkflow].shortLabel}</span>
                </Badge>
                {selectedWorkflow === 'CGP' && (
                  <Badge variant="secondary">
                    {selectedCGPPhase === 'FILING' ? 'Radicación' : 'Proceso'}
                  </Badge>
                )}
              </div>

              <Label className="text-sm font-medium">Etapa Actual</Label>
              
              <ScrollArea className="h-[280px] pr-4">
                <RadioGroup
                  value={selectedStage}
                  onValueChange={handleStageSelect}
                  className="space-y-2"
                >
                  {stageOrder.map((stageKey, index) => {
                    const stageConfig = stages[stageKey];
                    const isSelected = selectedStage === stageKey;
                    
                    return (
                      <div
                        key={stageKey}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => handleStageSelect(stageKey)}
                      >
                        <RadioGroupItem value={stageKey} id={`stage-${stageKey}`} />
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5">
                            {index + 1}.
                          </span>
                          <Label htmlFor={`stage-${stageKey}`} className="cursor-pointer">
                            {stageConfig?.label || stageKey}
                          </Label>
                        </div>
                      </div>
                    );
                  })}
                </RadioGroup>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          {step !== 'workflow' ? (
            <Button variant="outline" onClick={handleBack}>
              Atrás
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          )}
          
          {step === 'stage' && (
            <Button 
              onClick={handleConfirm} 
              disabled={!selectedStage}
            >
              Confirmar Clasificación
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
