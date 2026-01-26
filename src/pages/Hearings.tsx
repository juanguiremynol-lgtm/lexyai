import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Video,
  Plus,
  Trash2,
  ExternalLink,
  Bot,
  Bell,
  Mail,
  Search,
  Scale,
  Gavel,
  Building2,
  Landmark,
  Send,
  Check,
  ChevronsUpDown,
  Eye,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, isSameDay, addMonths, subMonths, isAfter, isBefore, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { WORKFLOW_TYPES, type WorkflowType } from "@/lib/workflow-constants";

// Work item option for hearing linking
interface WorkItemOption {
  id: string;
  workflow_type: WorkflowType;
  radicado: string | null;
  title: string | null;
  demandantes: string | null;
  demandados: string | null;
  authority_name: string | null;
  client_name: string | null;
}

interface Hearing {
  id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  is_virtual: boolean | null;
  virtual_link: string | null;
  notes: string | null;
  auto_detected: boolean | null;
  reminder_sent: boolean | null;
  work_item_id: string | null;
  organization_id: string | null;
  // Legacy fields (deprecated but may still have data)
  filing_id: string | null;
  cpaca_process_id: string | null;
  // Joined work_item data
  work_item?: {
    id: string;
    workflow_type: WorkflowType;
    radicado: string | null;
    title: string | null;
    demandantes: string | null;
    demandados: string | null;
    authority_name: string | null;
    client?: {
      name: string;
    } | null;
  } | null;
}

const WORKFLOW_ICONS: Record<WorkflowType, React.ReactNode> = {
  CGP: <Scale className="h-3 w-3" />,
  PETICION: <Send className="h-3 w-3" />,
  TUTELA: <Gavel className="h-3 w-3" />,
  GOV_PROCEDURE: <Building2 className="h-3 w-3" />,
  CPACA: <Landmark className="h-3 w-3" />,
  LABORAL: <Briefcase className="h-3 w-3" />,
  PENAL_906: <Shield className="h-3 w-3" />,
};

const WORKFLOW_COLORS: Record<WorkflowType, string> = {
  CGP: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  PETICION: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  TUTELA: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  GOV_PROCEDURE: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  CPACA: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  LABORAL: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  PENAL_906: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function Hearings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterWorkflow, setFilterWorkflow] = useState<string>("all");
  const [workItemSearchOpen, setWorkItemSearchOpen] = useState(false);
  const [workItemSearchQuery, setWorkItemSearchQuery] = useState("");
  const [formData, setFormData] = useState({
    title: "",
    scheduled_at: "",
    scheduled_time: "08:00",
    location: "",
    notes: "",
    is_virtual: false,
    virtual_link: "",
    work_item_id: "",
  });

  // Fetch all hearings with work_item details
  const { data: hearings, isLoading } = useQuery({
    queryKey: ["all-hearings", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hearings")
        .select(`
          *,
          work_item:work_items(
            id,
            workflow_type,
            radicado,
            title,
            demandantes,
            demandados,
            authority_name,
            client:clients(name)
          )
        `)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Hearing[];
    },
    enabled: !!organization?.id,
  });

  // Fetch all work_items for dropdown selection
  const { data: workItemOptions } = useQuery({
    queryKey: ["work-items-for-hearings", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id,
          workflow_type,
          radicado,
          title,
          demandantes,
          demandados,
          authority_name,
          client:clients(name)
        `)
        .order("created_at", { ascending: false })
        .limit(500);
      
      if (error) throw error;
      
      return (data || []).map((w) => ({
        id: w.id,
        workflow_type: w.workflow_type as WorkflowType,
        radicado: w.radicado,
        title: w.title,
        demandantes: w.demandantes,
        demandados: w.demandados,
        authority_name: w.authority_name,
        client_name: w.client?.name || null,
      })) as WorkItemOption[];
    },
    enabled: !!organization?.id,
  });

  // Filter work items for the combobox
  const filteredWorkItems = useMemo(() => {
    if (!workItemOptions) return [];
    if (!workItemSearchQuery) return workItemOptions;
    
    const query = workItemSearchQuery.toLowerCase();
    return workItemOptions.filter((w) => {
      return (
        w.radicado?.toLowerCase().includes(query) ||
        w.title?.toLowerCase().includes(query) ||
        w.demandantes?.toLowerCase().includes(query) ||
        w.demandados?.toLowerCase().includes(query) ||
        w.client_name?.toLowerCase().includes(query) ||
        w.authority_name?.toLowerCase().includes(query) ||
        WORKFLOW_TYPES[w.workflow_type]?.label.toLowerCase().includes(query)
      );
    });
  }, [workItemOptions, workItemSearchQuery]);

  // Get selected work item for display
  const selectedWorkItem = useMemo(() => {
    if (!formData.work_item_id || !workItemOptions) return null;
    return workItemOptions.find((w) => w.id === formData.work_item_id) || null;
  }, [formData.work_item_id, workItemOptions]);

  // Create hearing mutation with audit trail
  const createHearing = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      if (!formData.work_item_id) {
        throw new Error("Debe seleccionar un proceso");
      }

      const scheduledAt = new Date(`${formData.scheduled_at}T${formData.scheduled_time}`);

      // Insert hearing
      const { data: hearing, error: hearingError } = await supabase
        .from("hearings")
        .insert({
          owner_id: user.id,
          organization_id: organization?.id,
          work_item_id: formData.work_item_id,
          title: formData.title,
          scheduled_at: scheduledAt.toISOString(),
          location: formData.location || null,
          notes: formData.notes || null,
          is_virtual: formData.is_virtual,
          virtual_link: formData.virtual_link || null,
          auto_detected: false,
        })
        .select("id")
        .single();

      if (hearingError) throw hearingError;

      // Get work_item's legacy_filing_id for process_events compatibility
      const { data: workItem } = await supabase
        .from("work_items")
        .select("legacy_filing_id")
        .eq("id", formData.work_item_id)
        .single();

      // Create process_event audit trail (requires filing_id for legacy schema)
      if (workItem?.legacy_filing_id) {
        await supabase.from("process_events").insert({
          owner_id: user.id,
          filing_id: workItem.legacy_filing_id,
          event_type: "AUDIENCE_CREATED",
          event_date: new Date().toISOString(),
          description: `Audiencia programada: ${formData.title}`,
          source: "USER_UI",
          raw_data: {
            hearing_id: hearing.id,
            work_item_id: formData.work_item_id,
            title: formData.title,
            scheduled_at: scheduledAt.toISOString(),
            location: formData.location || null,
            is_virtual: formData.is_virtual,
          },
        });
      }

      // Create alert for the hearing
      const daysUntil = Math.ceil((scheduledAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      
      await supabase.from("alerts").insert({
        owner_id: user.id,
        severity: daysUntil <= 3 ? "CRITICAL" : daysUntil <= 7 ? "WARN" : "INFO",
        message: `Audiencia programada: ${formData.title} para ${scheduledAt.toLocaleDateString('es-CO')}`,
        is_read: false,
      });

      return hearing;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-hearings"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      toast.success("Audiencia programada con éxito");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Delete hearing mutation with audit trail
  const deleteHearing = useMutation({
    mutationFn: async (hearing: Hearing) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      // Create process_event audit trail before deletion
      if (hearing.work_item_id) {
        const { data: workItem } = await supabase
          .from("work_items")
          .select("legacy_filing_id")
          .eq("id", hearing.work_item_id)
          .single();

        if (workItem?.legacy_filing_id) {
          await supabase.from("process_events").insert({
            owner_id: user.id,
            filing_id: workItem.legacy_filing_id,
            event_type: "AUDIENCE_DELETED",
            event_date: new Date().toISOString(),
            description: `Audiencia eliminada: ${hearing.title}`,
            source: "USER_UI",
            raw_data: {
              hearing_id: hearing.id,
              work_item_id: hearing.work_item_id,
              title: hearing.title,
              scheduled_at: hearing.scheduled_at,
            },
          });
        }
      }

      const { error } = await supabase
        .from("hearings")
        .delete()
        .eq("id", hearing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-hearings"] });
      queryClient.invalidateQueries({ queryKey: ["process-events"] });
      toast.success("Audiencia eliminada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      scheduled_at: "",
      scheduled_time: "08:00",
      location: "",
      notes: "",
      is_virtual: false,
      virtual_link: "",
      work_item_id: "",
    });
    setWorkItemSearchQuery("");
  };

  // Filter and group hearings
  const filteredHearings = useMemo(() => {
    if (!hearings) return [];
    
    return hearings.filter(h => {
      // Search across work_item fields
      const workItemMatch = 
        h.work_item?.radicado?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.work_item?.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.work_item?.demandantes?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.work_item?.demandados?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.work_item?.client?.name?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSearch = searchQuery === "" || 
        h.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        workItemMatch;
      
      // Filter by workflow type
      if (filterWorkflow === "all") return matchesSearch;
      
      return matchesSearch && h.work_item?.workflow_type === filterWorkflow;
    });
  }, [hearings, searchQuery, filterWorkflow]);

  // Get hearings for a specific date
  const getHearingsForDate = (date: Date) => {
    return filteredHearings.filter(h => 
      isSameDay(new Date(h.scheduled_at), date)
    );
  };

  // Get hearings for current month (for calendar dots)
  const monthHearingDates = useMemo(() => {
    if (!filteredHearings) return new Set<string>();
    
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    
    return new Set(
      filteredHearings
        .filter(h => {
          const d = new Date(h.scheduled_at);
          return d >= start && d <= end;
        })
        .map(h => format(new Date(h.scheduled_at), "yyyy-MM-dd"))
    );
  }, [filteredHearings, currentMonth]);

  // Upcoming hearings (next 7 days)
  const upcomingHearings = useMemo(() => {
    const today = startOfDay(new Date());
    const weekLater = new Date(today);
    weekLater.setDate(weekLater.getDate() + 7);
    
    return filteredHearings.filter(h => {
      const d = new Date(h.scheduled_at);
      return isAfter(d, today) && isBefore(d, weekLater);
    });
  }, [filteredHearings]);

  // Selected date hearings
  const selectedDateHearings = getHearingsForDate(selectedDate);

  // Past hearings
  const pastHearings = useMemo(() => {
    const today = startOfDay(new Date());
    return filteredHearings.filter(h => isBefore(new Date(h.scheduled_at), today));
  }, [filteredHearings]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Clock className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display text-gold-gradient">Audiencias</h1>
          <p className="text-muted-foreground">
            Gestiona todas las audiencias programadas de tus procesos
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva Audiencia
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Programar Audiencia</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createHearing.mutate();
              }}
              className="space-y-4"
            >
              {/* Work Item Selector - Searchable Combobox */}
              <div className="space-y-2">
                <Label>Proceso / Caso</Label>
                <Popover open={workItemSearchOpen} onOpenChange={setWorkItemSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={workItemSearchOpen}
                      className="w-full justify-between h-auto min-h-10 py-2"
                    >
                      {selectedWorkItem ? (
                        <div className="flex items-start gap-2 text-left">
                          <Badge 
                            variant="secondary" 
                            className={cn("shrink-0 mt-0.5", WORKFLOW_COLORS[selectedWorkItem.workflow_type])}
                          >
                            {WORKFLOW_ICONS[selectedWorkItem.workflow_type]}
                            <span className="ml-1">{WORKFLOW_TYPES[selectedWorkItem.workflow_type]?.shortLabel}</span>
                          </Badge>
                          <div className="flex flex-col">
                            <span className="font-mono text-sm">
                              {selectedWorkItem.radicado || selectedWorkItem.title || "Sin identificar"}
                            </span>
                            {selectedWorkItem.client_name && (
                              <span className="text-xs text-muted-foreground">{selectedWorkItem.client_name}</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Seleccionar proceso...</span>
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput 
                        placeholder="Buscar por radicado, cliente, partes..." 
                        value={workItemSearchQuery}
                        onValueChange={setWorkItemSearchQuery}
                      />
                      <CommandList>
                        <CommandEmpty>No se encontraron procesos.</CommandEmpty>
                        <CommandGroup>
                          {filteredWorkItems.slice(0, 50).map((w) => (
                            <CommandItem
                              key={w.id}
                              value={w.id}
                              onSelect={() => {
                                setFormData({ ...formData, work_item_id: w.id });
                                setWorkItemSearchOpen(false);
                              }}
                              className="flex items-start gap-2 py-2"
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4 mt-0.5",
                                  formData.work_item_id === w.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <Badge 
                                variant="secondary" 
                                className={cn("shrink-0", WORKFLOW_COLORS[w.workflow_type])}
                              >
                                {WORKFLOW_ICONS[w.workflow_type]}
                                <span className="ml-1">{WORKFLOW_TYPES[w.workflow_type]?.shortLabel}</span>
                              </Badge>
                              <div className="flex flex-col flex-1 min-w-0">
                                <span className="font-mono text-sm truncate">
                                  {w.radicado || w.title || "Sin identificar"}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {[w.demandantes, w.demandados].filter(Boolean).join(" vs ") || w.authority_name || w.client_name || "—"}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ej: Audiencia inicial"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Fecha</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.scheduled_at}
                    onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time">Hora</Label>
                  <Input
                    id="time"
                    type="time"
                    value={formData.scheduled_time}
                    onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="is_virtual"
                  checked={formData.is_virtual}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_virtual: checked })}
                />
                <Label htmlFor="is_virtual">Audiencia virtual</Label>
              </div>

              {formData.is_virtual ? (
                <div className="space-y-2">
                  <Label htmlFor="virtual_link">Enlace de la reunión</Label>
                  <Input
                    id="virtual_link"
                    type="url"
                    value={formData.virtual_link}
                    onChange={(e) => setFormData({ ...formData, virtual_link: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="location">Ubicación</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="Ej: Palacio de Justicia, Sala 301"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="notes">Notas</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Notas adicionales..."
                  rows={3}
                />
              </div>

              <Button type="submit" className="w-full" disabled={createHearing.isPending}>
                <CalendarIcon className="h-4 w-4 mr-2" />
                Programar Audiencia
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar audiencias..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filterWorkflow} onValueChange={setFilterWorkflow}>
          <SelectTrigger className="w-full md:w-[250px]">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <span className="flex items-center gap-2">Todos los tipos</span>
            </SelectItem>
            {Object.entries(WORKFLOW_TYPES).map(([key, meta]) => (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  {WORKFLOW_ICONS[key as WorkflowType]}
                  {meta.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Calendario</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium min-w-[120px] text-center">
                  {format(currentMonth, "MMMM yyyy", { locale: es })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => date && setSelectedDate(date)}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              locale={es}
              className="rounded-md"
              modifiers={{
                hasHearing: (date) => monthHearingDates.has(format(date, "yyyy-MM-dd")),
              }}
              modifiersStyles={{
                hasHearing: {
                  fontWeight: "bold",
                  textDecoration: "underline",
                  textDecorationColor: "hsl(var(--primary))",
                },
              }}
            />
            
            {/* Legend */}
            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span>Con audiencia</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right side - Hearings lists */}
        <div className="lg:col-span-2 space-y-6">
          {/* Selected date hearings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarIcon className="h-5 w-5" />
                {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedDateHearings.length > 0 ? (
                <div className="space-y-3">
                  {selectedDateHearings.map((hearing) => (
                    <HearingCard
                      key={hearing.id}
                      hearing={hearing}
                      onDelete={() => deleteHearing.mutate(hearing)}
                      isDeleting={deleteHearing.isPending}
                      onNavigate={() => hearing.work_item_id && navigate(`/work-items/${hearing.work_item_id}`)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">
                  No hay audiencias programadas para este día
                </p>
              )}
            </CardContent>
          </Card>

          {/* Upcoming hearings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Bell className="h-5 w-5 text-amber-500" />
                Próximas 7 días
                {upcomingHearings.length > 0 && (
                  <Badge variant="secondary">{upcomingHearings.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingHearings.length > 0 ? (
                <div className="space-y-3">
                  {upcomingHearings.map((hearing) => (
                    <HearingCard
                      key={hearing.id}
                      hearing={hearing}
                      onDelete={() => deleteHearing.mutate(hearing)}
                      isDeleting={deleteHearing.isPending}
                      onNavigate={() => hearing.work_item_id && navigate(`/work-items/${hearing.work_item_id}`)}
                      showDate
                    />
                  ))}
                </div>
              ) : (
                <p className="text-center py-4 text-muted-foreground">
                  No hay audiencias en los próximos 7 días
                </p>
              )}
            </CardContent>
          </Card>

          {/* Past hearings (collapsed by default) */}
          {pastHearings.length > 0 && (
            <Card className="opacity-75">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg text-muted-foreground">
                  <Clock className="h-5 w-5" />
                  Audiencias pasadas
                  <Badge variant="outline">{pastHearings.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {pastHearings.slice(0, 5).map((hearing) => (
                    <HearingCard
                      key={hearing.id}
                      hearing={hearing}
                      onDelete={() => deleteHearing.mutate(hearing)}
                      isDeleting={deleteHearing.isPending}
                      onNavigate={() => hearing.work_item_id && navigate(`/work-items/${hearing.work_item_id}`)}
                      isPast
                      showDate
                    />
                  ))}
                  {pastHearings.length > 5 && (
                    <p className="text-center text-sm text-muted-foreground">
                      +{pastHearings.length - 5} audiencias más
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

interface HearingCardProps {
  hearing: Hearing;
  onDelete: () => void;
  onNavigate: () => void;
  isDeleting: boolean;
  isPast?: boolean;
  showDate?: boolean;
}

function HearingCard({ hearing, onDelete, onNavigate, isDeleting, isPast, showDate }: HearingCardProps) {
  const date = new Date(hearing.scheduled_at);
  const workItem = hearing.work_item;
  
  return (
    <div className={cn(
      "border rounded-lg p-4 transition-colors",
      isPast ? "bg-muted/50 opacity-75" : "bg-card hover:bg-accent/5"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h5 className="font-medium truncate">{hearing.title}</h5>
            {hearing.auto_detected && (
              <Badge variant="outline" className="text-xs shrink-0">
                <Bot className="h-3 w-3 mr-1" />
                Auto-detectada
              </Badge>
            )}
            {hearing.reminder_sent && (
              <Badge variant="secondary" className="text-xs shrink-0">
                <Mail className="h-3 w-3 mr-1" />
                Recordatorio enviado
              </Badge>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {showDate && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="h-4 w-4" />
                {formatDateColombia(hearing.scheduled_at)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
            </span>
            
            {hearing.is_virtual ? (
              <span className="flex items-center gap-1">
                <Video className="h-4 w-4" />
                Virtual
              </span>
            ) : hearing.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {hearing.location}
              </span>
            )}
          </div>

          {/* Work Item info */}
          {workItem && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge 
                variant="secondary" 
                className={cn("text-xs", WORKFLOW_COLORS[workItem.workflow_type])}
              >
                {WORKFLOW_ICONS[workItem.workflow_type]}
                <span className="ml-1">{WORKFLOW_TYPES[workItem.workflow_type]?.shortLabel}</span>
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {workItem.radicado || workItem.title || "Sin identificar"}
              </span>
              {workItem.client?.name && (
                <span className="text-xs text-muted-foreground">• {workItem.client.name}</span>
              )}
            </div>
          )}

          {hearing.notes && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{hearing.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hearing.work_item_id && (
            <Button
              variant="outline"
              size="icon"
              onClick={onNavigate}
              title="Ver proceso"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {hearing.is_virtual && hearing.virtual_link && (
            <Button
              variant="outline"
              size="icon"
              asChild
            >
              <a href={hearing.virtual_link} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}
