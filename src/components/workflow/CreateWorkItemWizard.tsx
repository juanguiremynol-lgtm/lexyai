import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
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
  Search,
  AlertCircle,
  CheckCircle2,
  FileText,
  MapPin,
  Users,
  Calendar,
  Briefcase,
  Shield,
  Sparkles,
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
import { useRadicadoLookup, type ProcessData } from "@/hooks/use-radicado-lookup";
import { normalizeRadicadoInput, formatRadicadoDisplay } from "@/lib/radicado-utils";
import { parseApiDate, generateSmartTitle } from "@/lib/date-utils";
import { toast } from "sonner";

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
  LABORAL: <Briefcase className="h-5 w-5" />,
  PENAL_906: <Shield className="h-5 w-5" />,
};

type WizardStep = 'workflow' | 'radicado' | 'details' | 'client';

export function CreateWorkItemWizard({
  open,
  onOpenChange,
  onSuccess,
  defaultClientId,
  defaultWorkflowType,
}: CreateWorkItemWizardProps) {
  const queryClient = useQueryClient();
  
  // Wizard state
  const [step, setStep] = useState<WizardStep>('workflow');
  
  // Step 1: Workflow type
  const [workflowType, setWorkflowType] = useState<WorkflowType | null>(defaultWorkflowType || null);
  const [cgpPhase, setCgpPhase] = useState<CGPPhase>('FILING');
  const [stage, setStage] = useState<string>('');
  
  // Radicado lookup
  const [radicado, setRadicado] = useState('');
  const [radicadoError, setRadicadoError] = useState<string | null>(null);
  const [useRadicadoInput, setUseRadicadoInput] = useState<'lookup' | 'manual'>('lookup');
  const { status: lookupStatus, result: lookupResult, error: lookupError, lookup, reset: resetLookup, validateRadicado } = useRadicadoLookup();
  
  // Step 2: Basic details
  const [title, setTitle] = useState('');
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
  
  // Track auto-populated fields for visual indicator
  const [autoPopulatedFields, setAutoPopulatedFields] = useState<Set<string>>(new Set());
  
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
      setStep(defaultWorkflowType ? 'radicado' : 'workflow');
      setWorkflowType(defaultWorkflowType || null);
      setCgpPhase('FILING');
      setStage('');
      setRadicado('');
      setUseRadicadoInput('lookup');
      resetLookup();
      setTitle('');
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
      setAutoPopulatedFields(new Set());
    }
  }, [open, defaultWorkflowType, defaultClientId, resetLookup]);
  
  // Set default stage when workflow changes
  useEffect(() => {
    if (workflowType) {
      const phase = workflowType === 'CGP' ? cgpPhase : undefined;
      setStage(getDefaultStage(workflowType, phase));
    }
  }, [workflowType, cgpPhase]);
  
  // Apply lookup data to form fields - EXPANDED
  useEffect(() => {
    if (lookupResult?.process_data && lookupStatus === 'success') {
      const data = lookupResult.process_data;
      const newAutoFields = new Set<string>();
      
      // Authority information
      if (data.despacho) {
        setAuthorityName(data.despacho);
        newAutoFields.add('authorityName');
      }
      if (data.ciudad) {
        setAuthorityCity(data.ciudad);
        newAutoFields.add('authorityCity');
      }
      if (data.departamento) {
        setAuthorityDepartment(data.departamento);
        newAutoFields.add('authorityDepartment');
      }
      
      // Parties (general)
      if (data.demandante) {
        setDemandantes(data.demandante);
        newAutoFields.add('demandantes');
      }
      if (data.demandado) {
        setDemandados(data.demandado);
        newAutoFields.add('demandados');
      }
      
      // Tutela-specific: accionado = demandado (legally equivalent)
      if (workflowType === 'TUTELA' && data.demandado) {
        setAccionado(data.demandado);
        newAutoFields.add('accionado');
      }
      
      // Filing date (workflow-specific)
      if (data.fecha_radicacion) {
        const parsedDate = parseApiDate(data.fecha_radicacion);
        if (parsedDate) {
          if (workflowType === 'TUTELA') {
            setTutelaFilingDate(parsedDate);
            newAutoFields.add('tutelaFilingDate');
          } else if (workflowType === 'PETICION') {
            setFilingDate(parsedDate);
            newAutoFields.add('filingDate');
          }
        }
      }
      
      // Auto-generate title if not manually set
      if (!title) {
        const smartTitle = generateSmartTitle(
          workflowType || '',
          data.tipo_proceso,
          data.demandante,
          data.demandado
        );
        if (smartTitle) {
          setTitle(smartTitle);
          newAutoFields.add('title');
        }
      }
      
      // Set CGP phase based on classification
      if (workflowType === 'CGP' && lookupResult.cgp_phase) {
        setCgpPhase(lookupResult.cgp_phase);
        newAutoFields.add('cgpPhase');
      }
      
      // Update auto-populated fields tracking
      setAutoPopulatedFields(newAutoFields);
    }
  }, [lookupResult, lookupStatus, workflowType, title]);
  
  const handleWorkflowSelect = (wf: WorkflowType) => {
    setWorkflowType(wf);
    resetLookup();
    setRadicado('');
    
    // Workflows that use radicado go to radicado step
    if (workflowUsesRadicado(wf)) {
      setStep('radicado');
    } else {
      setStep('details');
    }
  };
  
  const handleRadicadoLookup = async () => {
    // Clear previous errors
    setRadicadoError(null);
    
    // Validate before lookup
    const validation = validateRadicado(radicado, workflowType || undefined);
    if (!validation.valid) {
      setRadicadoError(validation.error || 'Radicado inválido');
      return;
    }
    
    await lookup(radicado, workflowType || undefined);
  };
  
  const handleRadicadoChange = (value: string) => {
    // Normalize input - strip non-digits, keep as string to preserve leading zeros
    const digits = normalizeRadicadoInput(value).slice(0, 23);
    setRadicado(digits);
    setRadicadoError(null);
    
    if (digits.length !== 23) {
      resetLookup();
    }
  };
  
  // Use the centralized formatRadicadoDisplay from radicado-utils
  const formatRadicado = (digits: string): string => {
    if (!digits) return "";
    // For partial input, show with separators for readability
    if (digits.length < 23) {
      const parts = [
        digits.slice(0, 2),
        digits.slice(2, 5),
        digits.slice(5, 7),
        digits.slice(7, 10),
        digits.slice(10, 14),
        digits.slice(14, 19),
        digits.slice(19, 21),
        digits.slice(21, 23),
      ].filter(Boolean);
      return parts.join("-");
    }
    // For complete radicado, use standard format
    return formatRadicadoDisplay(digits);
  };
  
  const handleProceedFromRadicado = () => {
    // If lookup was successful, use the detected phase and apply data
    if (lookupResult?.found_in_source && lookupResult.cgp_phase && workflowType === 'CGP') {
      setCgpPhase(lookupResult.cgp_phase);
      // Set appropriate stage based on classification
      if (lookupResult.cgp_phase === 'PROCESS') {
        setStage('AUTO_ADMISORIO');
      } else {
        setStage('RADICADO_CONFIRMED');
      }
    }
    setStep('details');
  };
  
  const handleNext = () => {
    if (step === 'workflow') {
      // This shouldn't happen now as we go directly from workflow select
    } else if (step === 'radicado') {
      handleProceedFromRadicado();
    } else if (step === 'details') {
      setStep('client');
    }
  };
  
  const handleBack = () => {
    if (step === 'client') {
      setStep('details');
    } else if (step === 'details') {
      if (workflowType && workflowUsesRadicado(workflowType)) {
        setStep('radicado');
      } else {
        setStep('workflow');
        setWorkflowType(null);
      }
    } else if (step === 'radicado') {
      setStep('workflow');
      setWorkflowType(null);
      resetLookup();
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
        toast.error("Error al crear cliente");
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
      data.description = `Medio de control: ${MEDIOS_DE_CONTROL[medioDeControl]?.label || medioDeControl}`;
    }
    
    if (workflowType === 'PETICION') {
      data.filing_date = filingDate || undefined;
    }
    
    if (workflowType === 'TUTELA') {
      data.filing_date = tutelaFilingDate || undefined;
    }
    
    // Pass initial actuaciones from lookup if available (persist on creation)
    if (lookupResult?.process_data?.actuaciones && lookupResult.process_data.actuaciones.length > 0) {
      data.initial_actuaciones = lookupResult.process_data.actuaciones;
      data.lookup_source = lookupResult.source_used || 'CPNU';
    }
    
    createWorkItem.mutate(data, {
      onSuccess: () => {
        // Invalidate queries to refresh pipelines
        queryClient.invalidateQueries({ queryKey: ["work-items"] });
        queryClient.invalidateQueries({ queryKey: ["cgp-work-items"] });
        queryClient.invalidateQueries({ queryKey: ["cpaca-work-items"] });
        queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
        
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
  
  const canProceedFromRadicado = () => {
    if (useRadicadoInput === 'manual') return true;
    if (radicado.length !== 23) return false;
    // Allow proceeding even if not found (manual entry)
    return lookupStatus === 'success' || lookupStatus === 'not_found' || lookupStatus === 'error';
  };
  
  const canProceedFromDetails = () => {
    if (!workflowType) return false;
    
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

  const getStepNumber = (s: WizardStep): number => {
    const steps: WizardStep[] = workflowType && workflowUsesRadicado(workflowType)
      ? ['workflow', 'radicado', 'details', 'client']
      : ['workflow', 'details', 'client'];
    return steps.indexOf(s);
  };

  const totalSteps = workflowType && workflowUsesRadicado(workflowType) ? 4 : 3;
  
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
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                getStepNumber(step) === i 
                  ? 'bg-primary text-primary-foreground' 
                  : getStepNumber(step) > i
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {getStepNumber(step) > i ? (
                  <Check className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < totalSteps - 1 && (
                <div className={`w-12 h-0.5 ${
                  getStepNumber(step) > i
                    ? 'bg-primary'
                    : 'bg-muted'
                }`} />
              )}
            </div>
          ))}
          <div className="flex-1" />
          <span className="text-sm text-muted-foreground">
            {step === 'workflow' && 'Tipo de Asunto'}
            {step === 'radicado' && 'Buscar Proceso'}
            {step === 'details' && 'Detalles'}
            {step === 'client' && 'Cliente'}
          </span>
        </div>
        
        <ScrollArea className="max-h-[55vh] pr-4">
          {/* Step 1: Workflow Type Selection */}
          {step === 'workflow' && (
            <div className="space-y-4 py-2">
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
            </div>
          )}
          
          {/* Step 2: Radicado Lookup (for workflows that use radicado) */}
          {step === 'radicado' && workflowType && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline" className="bg-primary/10">
                  {WORKFLOW_ICONS[workflowType]}
                  <span className="ml-1">{WORKFLOW_TYPES[workflowType].shortLabel}</span>
                </Badge>
              </div>
              
              <Tabs value={useRadicadoInput} onValueChange={(v) => setUseRadicadoInput(v as 'lookup' | 'manual')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="lookup">
                    <Search className="h-4 w-4 mr-2" />
                    Buscar por Radicado
                  </TabsTrigger>
                  <TabsTrigger value="manual">
                    <FileText className="h-4 w-4 mr-2" />
                    Ingresar Manualmente
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="lookup" className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Radicado (23 dígitos){workflowType === 'CGP' && <span className="text-muted-foreground"> - debe terminar en 00 o 01</span>}</Label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={formatRadicado(radicado)}
                        onChange={(e) => handleRadicadoChange(e.target.value)}
                        placeholder="05-001-400-302-3202-50063-800"
                        className={`font-mono flex-1 ${radicadoError ? 'border-destructive' : ''}`}
                        maxLength={30}
                      />
                      <Badge variant={radicado.length === 23 ? "default" : "secondary"} className="shrink-0 self-center">
                        {radicado.length}/23
                      </Badge>
                    </div>
                    {radicadoError ? (
                      <p className="text-xs text-destructive">{radicadoError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Ejemplo: 05001400302320250063800 (Depto-Mpio-Entidad-Espec-Año-Consec-Ctrl)
                      </p>
                    )}
                  </div>
                  
                  <Button 
                    onClick={handleRadicadoLookup}
                    disabled={radicado.length !== 23 || lookupStatus === 'loading'}
                    className="w-full"
                  >
                    {lookupStatus === 'loading' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Consultando APIs externas...
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Buscar Proceso
                      </>
                    )}
                  </Button>
                  
                  {/* Lookup Result */}
                  {lookupStatus === 'success' && lookupResult?.found_in_source && (
                    <ProcessPreview 
                      data={lookupResult.process_data} 
                      cgpPhase={lookupResult.cgp_phase}
                      classificationReason={lookupResult.classification_reason}
                      sourceUsed={lookupResult.source_used}
                      eventsCount={lookupResult.new_events_count}
                      syncStrategy={lookupResult.sync_strategy}
                      consolidationStats={lookupResult.consolidation_stats}
                      sourcesChecked={lookupResult.sources_checked}
                    />
                  )}
                  
                  {lookupStatus === 'not_found' && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Proceso no encontrado</AlertTitle>
                      <AlertDescription>
                        No se encontró información en las fuentes consultadas
                        {lookupResult?.sources_checked && lookupResult.sources_checked.length > 0 && (
                          <span className="block text-xs mt-1">
                            (Consultados: {lookupResult.sources_checked.join(', ')})
                          </span>
                        )}
                        . Puedes continuar e ingresar los datos manualmente.
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {lookupStatus === 'error' && lookupError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Error en consulta</AlertTitle>
                      <AlertDescription>{lookupError}</AlertDescription>
                    </Alert>
                  )}
                  
                  {/* Attempts detail */}
                  {lookupResult?.attempts && lookupResult.attempts.length > 0 && (
                    <div className="text-xs space-y-1 p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium text-muted-foreground">Fuentes consultadas:</p>
                      {lookupResult.attempts.map((attempt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          {attempt.success ? (
                            <CheckCircle2 className="h-3 w-3 text-primary" />
                          ) : (
                            <AlertCircle className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span>{attempt.source}</span>
                          <span className="text-muted-foreground">({attempt.latency_ms}ms)</span>
                          {attempt.events_found !== undefined && attempt.success && (
                            <span className="text-primary">{attempt.events_found} actuaciones</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="manual" className="mt-4 space-y-4">
                  <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertTitle>Ingreso manual</AlertTitle>
                    <AlertDescription>
                      Ingresarás los datos del proceso manualmente en el siguiente paso.
                      Podrás sincronizar la información después.
                    </AlertDescription>
                  </Alert>
                  
                  <div className="space-y-2">
                    <Label>Radicado (opcional){workflowType === 'CGP' && radicado.length === 23 && <span className="text-muted-foreground"> - debe terminar en 00 o 01</span>}</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={formatRadicado(radicado)}
                      onChange={(e) => handleRadicadoChange(e.target.value)}
                      placeholder="05-001-400-302-3202-50063-800"
                      className="font-mono"
                      maxLength={30}
                    />
                  </div>
                  
                  {/* Manual CGP phase selection */}
                  {workflowType === 'CGP' && (
                    <div className="space-y-2">
                      <Label>¿El proceso tiene Auto Admisorio?</Label>
                      <RadioGroup
                        value={cgpPhase}
                        onValueChange={(v) => setCgpPhase(v as CGPPhase)}
                        className="grid grid-cols-2 gap-2"
                      >
                        <div
                          className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${
                            cgpPhase === 'FILING' ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                          onClick={() => setCgpPhase('FILING')}
                        >
                          <RadioGroupItem value="FILING" id="manual-filing" />
                          <Label htmlFor="manual-filing" className="cursor-pointer">
                            <span className="font-medium">No (Radicación)</span>
                          </Label>
                        </div>
                        <div
                          className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer ${
                            cgpPhase === 'PROCESS' ? 'border-primary bg-primary/5' : 'border-border'
                          }`}
                          onClick={() => setCgpPhase('PROCESS')}
                        >
                          <RadioGroupItem value="PROCESS" id="manual-process" />
                          <Label htmlFor="manual-process" className="cursor-pointer">
                            <span className="font-medium">Sí (Proceso)</span>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
          
          {/* Step 3: Details */}
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
                {radicado && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {formatRadicado(radicado)}
                  </Badge>
                )}
              </div>
              
              {/* Auto-populated fields notification */}
              {autoPopulatedFields.size > 0 && (
                <Alert className="bg-primary/5 border-primary/20">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <AlertTitle className="text-primary text-sm">Datos obtenidos automáticamente</AlertTitle>
                  <AlertDescription className="text-xs text-muted-foreground">
                    Se han pre-llenado {autoPopulatedFields.size} campo(s) con información del proceso. Puedes editarlos si es necesario.
                  </AlertDescription>
                </Alert>
              )}
              
              {/* Common fields */}
              <div className="grid gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Título / Referencia</Label>
                    {autoPopulatedFields.has('title') && (
                      <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Auto
                      </Badge>
                    )}
                  </div>
                  <Input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setAutoPopulatedFields(prev => {
                        const next = new Set(prev);
                        next.delete('title');
                        return next;
                      });
                    }}
                    placeholder="Ej: Proceso ejecutivo contra Empresa XYZ"
                    className={autoPopulatedFields.has('title') ? 'border-primary/30' : ''}
                  />
                </div>
                
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
                        <div className="flex items-center gap-2">
                          <Label>Ciudad</Label>
                          {autoPopulatedFields.has('authorityCity') && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Input
                          value={authorityCity}
                          onChange={(e) => {
                            setAuthorityCity(e.target.value);
                            setAutoPopulatedFields(prev => {
                              const next = new Set(prev);
                              next.delete('authorityCity');
                              return next;
                            });
                          }}
                          placeholder="Ej: Bogotá"
                          className={autoPopulatedFields.has('authorityCity') ? 'border-primary/30' : ''}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label>Juzgado / Despacho</Label>
                          {autoPopulatedFields.has('authorityName') && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Input
                          value={authorityName}
                          onChange={(e) => {
                            setAuthorityName(e.target.value);
                            setAutoPopulatedFields(prev => {
                              const next = new Set(prev);
                              next.delete('authorityName');
                              return next;
                            });
                          }}
                          placeholder="Ej: Juzgado 1 Civil del Circuito"
                          className={autoPopulatedFields.has('authorityName') ? 'border-primary/30' : ''}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label>Demandante(s)</Label>
                          {autoPopulatedFields.has('demandantes') && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Input
                          value={demandantes}
                          onChange={(e) => {
                            setDemandantes(e.target.value);
                            setAutoPopulatedFields(prev => {
                              const next = new Set(prev);
                              next.delete('demandantes');
                              return next;
                            });
                          }}
                          placeholder="Nombre del demandante"
                          className={autoPopulatedFields.has('demandantes') ? 'border-primary/30' : ''}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label>Demandado(s)</Label>
                          {autoPopulatedFields.has('demandados') && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Input
                          value={demandados}
                          onChange={(e) => {
                            setDemandados(e.target.value);
                            setAutoPopulatedFields(prev => {
                              const next = new Set(prev);
                              next.delete('demandados');
                              return next;
                            });
                          }}
                          placeholder="Nombre del demandado"
                          className={autoPopulatedFields.has('demandados') ? 'border-primary/30' : ''}
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
                      <div className="flex items-center gap-2">
                        <Label>Accionado</Label>
                        {autoPopulatedFields.has('accionado') && (
                          <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Auto
                          </Badge>
                        )}
                      </div>
                      <Input
                        value={accionado}
                        onChange={(e) => {
                          setAccionado(e.target.value);
                          setAutoPopulatedFields(prev => {
                            const next = new Set(prev);
                            next.delete('accionado');
                            return next;
                          });
                        }}
                        placeholder="Ej: EPS Sanitas"
                        className={autoPopulatedFields.has('accionado') ? 'border-primary/30' : ''}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label>Fecha de Radicación</Label>
                          {autoPopulatedFields.has('tutelaFilingDate') && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Input
                          type="date"
                          value={tutelaFilingDate}
                          onChange={(e) => {
                            setTutelaFilingDate(e.target.value);
                            setAutoPopulatedFields(prev => {
                              const next = new Set(prev);
                              next.delete('tutelaFilingDate');
                              return next;
                            });
                          }}
                          className={autoPopulatedFields.has('tutelaFilingDate') ? 'border-primary/30' : ''}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label>Juzgado</Label>
                          {autoPopulatedFields.has('authorityName') && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30 h-5 px-1.5">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                        <Input
                          value={authorityName}
                          onChange={(e) => {
                            setAuthorityName(e.target.value);
                            setAutoPopulatedFields(prev => {
                              const next = new Set(prev);
                              next.delete('authorityName');
                              return next;
                            });
                          }}
                          placeholder="Ej: Juzgado 1 Civil Municipal"
                          className={autoPopulatedFields.has('authorityName') ? 'border-primary/30' : ''}
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
          
          {/* Step 4: Client */}
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
            
            {step === 'radicado' && (
              <Button onClick={handleNext} disabled={!canProceedFromRadicado()}>
                Siguiente
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            
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

// Process Preview Component
function ProcessPreview({
  data,
  cgpPhase,
  classificationReason,
  sourceUsed,
  eventsCount,
  syncStrategy,
  consolidationStats,
  sourcesChecked,
}: {
  data?: ProcessData;
  cgpPhase: 'FILING' | 'PROCESS';
  classificationReason?: string;
  sourceUsed?: string | null;
  eventsCount: number;
  syncStrategy?: 'fallback' | 'parallel';
  consolidationStats?: {
    total_from_sources: number;
    after_dedup: number;
    duplicates_removed: number;
  };
  sourcesChecked?: string[];
}) {
  if (!data) return null;
  
  const isParallel = syncStrategy === 'parallel';
  const successfulSources = sourcesChecked?.length || 0;
  
  return (
    <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-primary" />
          <span className="font-medium">Proceso encontrado</span>
          {isParallel && successfulSources > 1 && (
            <Badge variant="default" className="text-xs">
              ✓ {successfulSources} fuentes
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={cgpPhase === 'PROCESS' ? 'default' : 'secondary'}>
            {cgpPhase === 'PROCESS' ? 'Proceso (Admitido)' : 'Radicación (Pendiente)'}
          </Badge>
          {sourceUsed && !isParallel && (
            <Badge variant="outline" className="text-xs">
              {sourceUsed}
            </Badge>
          )}
        </div>
      </div>
      
      {/* Parallel sync consolidation stats */}
      {isParallel && consolidationStats && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm text-primary">
              Sincronización Multi-Fuente
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-muted-foreground">Total encontradas</p>
              <p className="text-lg font-bold">{consolidationStats.total_from_sources}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Duplicados removidos</p>
              <p className="text-lg font-bold text-warning">
                -{consolidationStats.duplicates_removed}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Únicos a guardar</p>
              <p className="text-lg font-bold text-primary">
                {consolidationStats.after_dedup}
              </p>
            </div>
          </div>
          {sourcesChecked && sourcesChecked.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Fuentes: {sourcesChecked.join(', ')}
            </p>
          )}
        </div>
      )}
      
      <Separator />
      
      <div className="grid gap-2 text-sm">
        {data.despacho && (
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-muted-foreground">Despacho:</span>
              <span className="ml-2">{data.despacho}</span>
            </div>
          </div>
        )}
        
        {(data.demandante || data.demandado) && (
          <div className="flex items-start gap-2">
            <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 space-y-1">
              {data.demandante && (
                <div>
                  <span className="text-muted-foreground">Demandante:</span>
                  <span className="ml-2">{data.demandante}</span>
                </div>
              )}
              {data.demandado && (
                <div>
                  <span className="text-muted-foreground">Demandado:</span>
                  <span className="ml-2">{data.demandado}</span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {data.tipo_proceso && (
          <div className="flex items-start gap-2">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-muted-foreground">Tipo:</span>
              <span className="ml-2">{data.tipo_proceso}</span>
            </div>
          </div>
        )}
        
        {eventsCount > 0 && (
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-muted-foreground">Actuaciones:</span>
              <span className="ml-2">{eventsCount}</span>
            </div>
          </div>
        )}
      </div>
      
      {classificationReason && (
        <p className="text-xs text-muted-foreground bg-background/50 p-2 rounded">
          {classificationReason}
        </p>
      )}
    </div>
  );
}
