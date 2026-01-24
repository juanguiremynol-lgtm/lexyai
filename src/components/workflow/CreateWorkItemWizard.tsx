import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Scale, 
  Send, 
  Gavel, 
  Building2, 
  Landmark, 
  ChevronRight, 
  ChevronLeft,
  Check,
  User,
  Plus,
  Loader2,
} from "lucide-react";
import {
  type WorkflowType,
  type CGPPhase,
  WORKFLOW_TYPES,
  WORKFLOW_TYPES_ORDER,
  getStagesForWorkflow,
  getStageOrderForWorkflow,
  getDefaultStage,
  workflowUsesRadicado,
} from "@/lib/workflow-constants";
import { COLOMBIAN_DEPARTMENTS } from "@/lib/constants";
import { CGP_CUANTIA_CONFIG } from "@/lib/cgp-constants";
import { MEDIOS_DE_CONTROL, type MedioDeControl } from "@/lib/cpaca-constants";
import { useCreateWorkItem, type CreateWorkItemData } from "@/hooks/use-create-work-item";

interface CreateWorkItemWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultClientId?: string;
  defaultWorkflowType?: WorkflowType;
}

const WORKFLOW_ICONS: Record<WorkflowType, React.ReactNode> = {
  CGP: <Scale className="h-5 w-5" />,
  PETICION: <Send className="h-5 w-5" />,
  TUTELA: <Gavel className="h-5 w-5" />,
  GOV_PROCEDURE: <Building2 className="h-5 w-5" />,
  CPACA: <Landmark className="h-5 w-5" />,
};

type WizardStep = 'workflow' | 'details' | 'client';

export function CreateWorkItemWizard({
  open,
  onOpenChange,
  onSuccess,
  defaultClientId,
  defaultWorkflowType,
}: CreateWorkItemWizardProps) {
  // Wizard state
  const [step, setStep] = useState<WizardStep>('workflow');
  
  // Step 1: Workflow type
  const [workflowType, setWorkflowType] = useState<WorkflowType | null>(defaultWorkflowType || null);
  const [cgpPhase, setCgpPhase] = useState<CGPPhase>('FILING');
  const [stage, setStage] = useState<string>('');
  
  // Step 2: Basic details
  const [title, setTitle] = useState('');
  const [radicado, setRadicado] = useState('');
  const [authorityName, setAuthorityName] = useState('');
  const [authorityCity, setAuthorityCity] = useState('');
  const [authorityDepartment, setAuthorityDepartment] = useState('');
  const [demandantes, setDemandantes] = useState('');
  const [demandados, setDemandados] = useState('');
  const [notes, setNotes] = useState('');
  
  // CGP-specific
  const [cgpCuantia, setCgpCuantia] = useState('');
  
  // CPACA-specific
  const [medioDeControl, setMedioDeControl] = useState<MedioDeControl | ''>('');
  
  // Peticion-specific
  const [filingDate, setFilingDate] = useState('');
  const [entityName, setEntityName] = useState('');
  
  // Tutela-specific
  const [accionado, setAccionado] = useState('');
  const [tutelaFilingDate, setTutelaFilingDate] = useState('');
  
  // Step 3: Client
  const [clientId, setClientId] = useState<string>(defaultClientId || '');
  const [clientTab, setClientTab] = useState<'existing' | 'new'>('existing');
  const [newClientName, setNewClientName] = useState('');
  const [newClientIdNumber, setNewClientIdNumber] = useState('');
  
  const createWorkItem = useCreateWorkItem();
  
  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, id_number")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  
  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setStep(defaultWorkflowType ? 'details' : 'workflow');
      setWorkflowType(defaultWorkflowType || null);
      setCgpPhase('FILING');
      setStage('');
      setTitle('');
      setRadicado('');
      setAuthorityName('');
      setAuthorityCity('');
      setAuthorityDepartment('');
      setDemandantes('');
      setDemandados('');
      setNotes('');
      setCgpCuantia('');
      setMedioDeControl('');
      setFilingDate('');
      setEntityName('');
      setAccionado('');
      setTutelaFilingDate('');
      setClientId(defaultClientId || '');
      setClientTab('existing');
      setNewClientName('');
      setNewClientIdNumber('');
    }
  }, [open, defaultWorkflowType, defaultClientId]);
  
  // Set default stage when workflow changes
  useEffect(() => {
    if (workflowType) {
      const phase = workflowType === 'CGP' ? cgpPhase : undefined;
      setStage(getDefaultStage(workflowType, phase));
    }
  }, [workflowType, cgpPhase]);
  
  const handleWorkflowSelect = (wf: WorkflowType) => {
    setWorkflowType(wf);
    if (wf !== 'CGP') {
      setStep('details');
    }
  };
  
  const handleCGPPhaseSelect = (phase: CGPPhase) => {
    setCgpPhase(phase);
    setStep('details');
  };
  
  const handleNext = () => {
    if (step === 'workflow') {
      if (workflowType === 'CGP') {
        // Stay on workflow to select phase
      } else if (workflowType) {
        setStep('details');
      }
    } else if (step === 'details') {
      setStep('client');
    }
  };
  
  const handleBack = () => {
    if (step === 'client') {
      setStep('details');
    } else if (step === 'details') {
      setStep('workflow');
      setWorkflowType(null);
    }
  };
  
  const handleCreateClient = async () => {
    if (!newClientName.trim()) return null;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    const { data, error } = await supabase
      .from("clients")
      .insert({
        owner_id: user.id,
        name: newClientName.trim(),
        id_number: newClientIdNumber.trim() || null,
      })
      .select()
      .single();
    
    if (error) throw error;
    return data.id;
  };
  
  const handleSubmit = async () => {
    if (!workflowType || !clientId && clientTab === 'existing') {
      return;
    }
    
    let finalClientId = clientId;
    
    // Create new client if needed
    if (clientTab === 'new' && newClientName.trim()) {
      try {
        finalClientId = await handleCreateClient() || '';
      } catch (e) {
        console.error("Error creating client:", e);
        return;
      }
    }
    
    if (!finalClientId) return;
    
    const data: CreateWorkItemData = {
      workflow_type: workflowType,
      stage,
      client_id: finalClientId,
      title: title || undefined,
      radicado: radicado || undefined,
      authority_name: authorityName || entityName || undefined,
      authority_city: authorityCity || undefined,
      authority_department: authorityDepartment || undefined,
      demandantes: demandantes || undefined,
      demandados: demandados || accionado || undefined,
      notes: notes || undefined,
    };
    
    // Workflow-specific fields
    if (workflowType === 'CGP') {
      data.cgp_phase = cgpPhase;
      data.cgp_cuantia = cgpCuantia || undefined;
    }
    
    if (workflowType === 'CPACA' && medioDeControl) {
      // Store medio de control in description or source_payload
      data.description = `Medio de control: ${MEDIOS_DE_CONTROL[medioDeControl]?.label || medioDeControl}`;
    }
    
    if (workflowType === 'PETICION') {
      data.filing_date = filingDate || undefined;
    }
    
    if (workflowType === 'TUTELA') {
      data.filing_date = tutelaFilingDate || undefined;
    }
    
    createWorkItem.mutate(data, {
      onSuccess: () => {
        onOpenChange(false);
        onSuccess?.();
      },
    });
  };
  
  const stages = workflowType 
    ? getStagesForWorkflow(workflowType, workflowType === 'CGP' ? cgpPhase : undefined)
    : {};
  const stageOrder = workflowType 
    ? getStageOrderForWorkflow(workflowType, workflowType === 'CGP' ? cgpPhase : undefined)
    : [];
  
  const canProceedFromDetails = () => {
    if (!workflowType) return false;
    
    // Each workflow has minimum requirements
    switch (workflowType) {
      case 'CGP':
        return !!stage;
      case 'PETICION':
        return !!entityName || !!authorityName;
      case 'TUTELA':
        return true;
      case 'GOV_PROCEDURE':
        return !!authorityName;
      case 'CPACA':
        return !!medioDeControl;
      default:
        return true;
    }
  };
  
  const canSubmit = () => {
    if (!workflowType) return false;
    if (clientTab === 'existing' && !clientId) return false;
    if (clientTab === 'new' && !newClientName.trim()) return false;
    return true;
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Nuevo Asunto</DialogTitle>
          <DialogDescription>
            Crea un nuevo asunto en el sistema
          </DialogDescription>
        </DialogHeader>
        
        {/* Progress indicator */}
        <div className="flex items-center gap-2 py-2">
          {(['workflow', 'details', 'client'] as WizardStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                step === s 
                  ? 'bg-primary text-primary-foreground' 
                  : i < ['workflow', 'details', 'client'].indexOf(step)
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {i < ['workflow', 'details', 'client'].indexOf(step) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 2 && (
                <div className={`w-12 h-0.5 ${
                  i < ['workflow', 'details', 'client'].indexOf(step)
                    ? 'bg-primary'
                    : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">
            {step === 'workflow' && 'Tipo de Asunto'}
            {step === 'details' && 'Detalles'}
            {step === 'client' && 'Cliente'}
          </span>
        </div>
        
        <ScrollArea className="max-h-[55vh] pr-4">
          {/* Step 1: Workflow Type Selection */}
          {step === 'workflow' && (
            <div className="space-y-4 py-2">
              {!workflowType ? (
                <>
                  <Label className="text-sm font-medium">¿Qué tipo de asunto deseas crear?</Label>
                  <div className="grid gap-2">
                    {WORKFLOW_TYPES_ORDER.map((type) => {
                      const config = WORKFLOW_TYPES[type];
                      return (
                        <button
                          key={type}
                          onClick={() => handleWorkflowSelect(type)}
                          className="flex items-center gap-3 p-4 rounded-lg border border-border text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
                        >
                          <div className="p-2 rounded-md bg-primary/10 text-primary">
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
                </>
              ) : workflowType === 'CGP' && step === 'workflow' ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant="outline" className="bg-primary/10">
                      <Scale className="h-3 w-3 mr-1" />
                      CGP
                    </Badge>
                  </div>
                  <Label className="text-sm font-medium">¿Este asunto ya tiene Auto Admisorio?</Label>
                  <RadioGroup
                    value={cgpPhase}
                    onValueChange={(v) => handleCGPPhaseSelect(v as CGPPhase)}
                    className="grid gap-3 mt-2"
                  >
                    <div
                      className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                        cgpPhase === 'FILING'
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
                        cgpPhase === 'PROCESS'
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
                          La demanda ya tiene auto admisorio
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </>
              ) : null}
            </div>
          )}
          
          {/* Step 2: Details */}
          {step === 'details' && workflowType && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="bg-primary/10">
                  {WORKFLOW_ICONS[workflowType]}
                  <span className="ml-1">{WORKFLOW_TYPES[workflowType].shortLabel}</span>
                </Badge>
                {workflowType === 'CGP' && (
                  <Badge variant="secondary">
                    {cgpPhase === 'FILING' ? 'Radicación' : 'Proceso'}
                  </Badge>
                )}
              </div>
              
              {/* Common fields */}
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label>Título / Referencia</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ej: Proceso ejecutivo contra Empresa XYZ"
                  />
                </div>
                
                {/* Radicado field for applicable workflows */}
                {workflowUsesRadicado(workflowType) && (
                  <div className="space-y-2">
                    <Label>Radicado (23 dígitos)</Label>
                    <Input
                      value={radicado}
                      onChange={(e) => setRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
                      placeholder="Ej: 11001310300220230012300"
                      maxLength={23}
                    />
                    {radicado && radicado.length !== 23 && (
                      <p className="text-xs text-amber-600">
                        El radicado debe tener 23 dígitos ({radicado.length}/23)
                      </p>
                    )}
                  </div>
                )}
                
                {/* Stage selection */}
                <div className="space-y-2">
                  <Label>Etapa Inicial</Label>
                  <Select value={stage} onValueChange={setStage}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona la etapa" />
                    </SelectTrigger>
                    <SelectContent>
                      {stageOrder.map((stageKey) => (
                        <SelectItem key={stageKey} value={stageKey}>
                          {stages[stageKey]?.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Workflow-specific fields */}
                {workflowType === 'CGP' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Cuantía</Label>
                        <Select value={cgpCuantia} onValueChange={setCgpCuantia}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona cuantía" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CGP_CUANTIA_CONFIG).map(([key, config]) => (
                              <SelectItem key={key} value={key}>
                                {config.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Departamento</Label>
                        <Select value={authorityDepartment} onValueChange={setAuthorityDepartment}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona departamento" />
                          </SelectTrigger>
                          <SelectContent>
                            {COLOMBIAN_DEPARTMENTS.map((dep) => (
                              <SelectItem key={dep} value={dep}>
                                {dep}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Ciudad</Label>
                        <Input
                          value={authorityCity}
                          onChange={(e) => setAuthorityCity(e.target.value)}
                          placeholder="Ej: Bogotá"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Juzgado / Despacho</Label>
                        <Input
                          value={authorityName}
                          onChange={(e) => setAuthorityName(e.target.value)}
                          placeholder="Ej: Juzgado 1 Civil del Circuito"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Demandante(s)</Label>
                        <Input
                          value={demandantes}
                          onChange={(e) => setDemandantes(e.target.value)}
                          placeholder="Nombre del demandante"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Demandado(s)</Label>
                        <Input
                          value={demandados}
                          onChange={(e) => setDemandados(e.target.value)}
                          placeholder="Nombre del demandado"
                        />
                      </div>
                    </div>
                  </>
                )}
                
                {workflowType === 'CPACA' && (
                  <>
                    <div className="space-y-2">
                      <Label>Medio de Control *</Label>
                      <Select value={medioDeControl} onValueChange={(v) => setMedioDeControl(v as MedioDeControl)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona el medio de control" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(MEDIOS_DE_CONTROL).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                              {config.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Departamento</Label>
                        <Select value={authorityDepartment} onValueChange={setAuthorityDepartment}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona departamento" />
                          </SelectTrigger>
                          <SelectContent>
                            {COLOMBIAN_DEPARTMENTS.map((dep) => (
                              <SelectItem key={dep} value={dep}>
                                {dep}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Ciudad</Label>
                        <Input
                          value={authorityCity}
                          onChange={(e) => setAuthorityCity(e.target.value)}
                          placeholder="Ej: Bogotá"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Juzgado / Tribunal</Label>
                      <Input
                        value={authorityName}
                        onChange={(e) => setAuthorityName(e.target.value)}
                        placeholder="Ej: Tribunal Administrativo de Cundinamarca"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Demandante(s)</Label>
                        <Input
                          value={demandantes}
                          onChange={(e) => setDemandantes(e.target.value)}
                          placeholder="Nombre del demandante"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Demandado(s)</Label>
                        <Input
                          value={demandados}
                          onChange={(e) => setDemandados(e.target.value)}
                          placeholder="Nombre del demandado"
                        />
                      </div>
                    </div>
                  </>
                )}
                
                {workflowType === 'PETICION' && (
                  <>
                    <div className="space-y-2">
                      <Label>Entidad Destinataria *</Label>
                      <Input
                        value={entityName}
                        onChange={(e) => setEntityName(e.target.value)}
                        placeholder="Ej: Ministerio de Salud"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Fecha de Radicación</Label>
                      <Input
                        type="date"
                        value={filingDate}
                        onChange={(e) => setFilingDate(e.target.value)}
                      />
                    </div>
                  </>
                )}
                
                {workflowType === 'TUTELA' && (
                  <>
                    <div className="space-y-2">
                      <Label>Accionado</Label>
                      <Input
                        value={accionado}
                        onChange={(e) => setAccionado(e.target.value)}
                        placeholder="Ej: EPS Sanitas"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Fecha de Radicación</Label>
                        <Input
                          type="date"
                          value={tutelaFilingDate}
                          onChange={(e) => setTutelaFilingDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Juzgado</Label>
                        <Input
                          value={authorityName}
                          onChange={(e) => setAuthorityName(e.target.value)}
                          placeholder="Ej: Juzgado 1 Civil Municipal"
                        />
                      </div>
                    </div>
                  </>
                )}
                
                {workflowType === 'GOV_PROCEDURE' && (
                  <>
                    <div className="space-y-2">
                      <Label>Autoridad / Entidad *</Label>
                      <Input
                        value={authorityName}
                        onChange={(e) => setAuthorityName(e.target.value)}
                        placeholder="Ej: Superintendencia de Industria y Comercio"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Departamento</Label>
                        <Select value={authorityDepartment} onValueChange={setAuthorityDepartment}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona departamento" />
                          </SelectTrigger>
                          <SelectContent>
                            {COLOMBIAN_DEPARTMENTS.map((dep) => (
                              <SelectItem key={dep} value={dep}>
                                {dep}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Ciudad</Label>
                        <Input
                          value={authorityCity}
                          onChange={(e) => setAuthorityCity(e.target.value)}
                          placeholder="Ej: Bogotá"
                        />
                      </div>
                    </div>
                  </>
                )}
                
                {/* Notes for all */}
                <div className="space-y-2">
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas adicionales sobre el asunto..."
                    rows={2}
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Step 3: Client */}
          {step === 'client' && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 mb-4">
                <User className="h-5 w-5 text-muted-foreground" />
                <Label className="text-sm font-medium">Vincular Cliente (Requerido)</Label>
              </div>
              
              <Tabs value={clientTab} onValueChange={(v) => setClientTab(v as 'existing' | 'new')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="existing">Cliente Existente</TabsTrigger>
                  <TabsTrigger value="new">Nuevo Cliente</TabsTrigger>
                </TabsList>
                
                <TabsContent value="existing" className="mt-4">
                  {clients.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No tienes clientes registrados</p>
                      <p className="text-sm mt-1">Crea uno en la pestaña "Nuevo Cliente"</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Selecciona un cliente</Label>
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona el cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          {clients.map((client) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.name}
                              {client.id_number && (
                                <span className="text-muted-foreground ml-2">
                                  ({client.id_number})
                                </span>
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="new" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Nombre del Cliente *</Label>
                    <Input
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                      placeholder="Nombre completo o razón social"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Número de Identificación</Label>
                    <Input
                      value={newClientIdNumber}
                      onChange={(e) => setNewClientIdNumber(e.target.value)}
                      placeholder="CC, NIT, etc."
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </ScrollArea>
        
        <DialogFooter className="flex justify-between gap-2 pt-4 border-t">
          <div>
            {step !== 'workflow' && (
              <Button variant="outline" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Atrás
              </Button>
            )}
          </div>
          
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            
            {step === 'details' && (
              <Button onClick={handleNext} disabled={!canProceedFromDetails()}>
                Siguiente
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            
            {step === 'client' && (
              <Button 
                onClick={handleSubmit} 
                disabled={!canSubmit() || createWorkItem.isPending}
              >
                {createWorkItem.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1" />
                    Crear Asunto
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
