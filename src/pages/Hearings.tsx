import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  FileText,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDateColombia } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, isSameDay, addMonths, subMonths, isAfter, isBefore, startOfDay } from "date-fns";
import { es } from "date-fns/locale";

// Unified process type for hearing linking
interface ProcessOption {
  id: string;
  type: "filing" | "cpaca";
  radicado: string | null;
  label: string;
  clientName: string | null;
  category: string;
  icon: "scale" | "gavel" | "file" | "building";
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
  filing_id: string | null;
  cpaca_process_id: string | null;
  filing?: {
    id: string;
    radicado: string | null;
    filing_type: string;
    matter?: {
      client_name: string;
      matter_name: string;
    };
    client?: {
      name: string;
    };
    linked_process?: {
      id: string;
      radicado: string;
      demandantes: string | null;
    };
  };
  cpaca_process?: {
    id: string;
    radicado: string | null;
    titulo: string | null;
    medio_de_control: string;
    client?: {
      name: string;
    };
  };
}

export default function Hearings() {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProcess, setFilterProcess] = useState<string>("all");
  const [formData, setFormData] = useState({
    title: "",
    scheduled_at: "",
    scheduled_time: "08:00",
    location: "",
    notes: "",
    is_virtual: false,
    virtual_link: "",
    process_key: "", // Format: "type:id" e.g., "filing:uuid" or "cpaca:uuid"
  });

  // Fetch all hearings with filing/process details
  const { data: hearings, isLoading } = useQuery({
    queryKey: ["all-hearings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hearings")
        .select(`
          *,
          filing:filings(
            id,
            radicado,
            filing_type,
            matter:matters(client_name, matter_name),
            client:clients(name),
            linked_process:monitored_processes(id, radicado, demandantes)
          ),
          cpaca_process:cpaca_processes(
            id,
            radicado,
            titulo,
            medio_de_control,
            client:clients(name)
          )
        `)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Hearing[];
    },
  });

  // Fetch all process options for dropdown (filings + CPACA)
  const { data: processOptions } = useQuery({
    queryKey: ["hearing-process-options"],
    queryFn: async () => {
      const options: ProcessOption[] = [];

      // Fetch filings (CGP, Tutelas, Peticiones, etc.)
      const { data: filings, error: filingsError } = await supabase
        .from("filings")
        .select(`
          id,
          radicado,
          filing_type,
          matter:matters(client_name, matter_name),
          client:clients(name)
        `)
        .order("created_at", { ascending: false });
      
      if (filingsError) throw filingsError;

      filings?.forEach((f) => {
        const clientName = f.client?.name || f.matter?.client_name || null;
        let category = "Proceso";
        let icon: ProcessOption["icon"] = "scale";
        
        if (f.filing_type === "TUTELA" || f.filing_type === "Tutela") {
          category = "Tutela";
          icon = "gavel";
        } else if (f.filing_type === "PETICION" || f.filing_type === "Peticion" || f.filing_type === "DERECHO_PETICION") {
          category = "Derecho de Petición";
          icon = "file";
        } else if (f.filing_type === "HABEAS_CORPUS" || f.filing_type === "Habeas Corpus") {
          category = "Habeas Corpus";
          icon = "gavel";
        } else if (f.filing_type === "Demanda" || f.filing_type === "DEMANDA") {
          category = "Proceso CGP";
          icon = "scale";
        }

        options.push({
          id: f.id,
          type: "filing",
          radicado: f.radicado,
          label: f.radicado || f.matter?.matter_name || "Sin radicado",
          clientName,
          category,
          icon,
        });
      });

      // Fetch CPACA processes
      const { data: cpacaProcesses, error: cpacaError } = await supabase
        .from("cpaca_processes")
        .select(`
          id,
          radicado,
          titulo,
          medio_de_control,
          client:clients(name)
        `)
        .order("created_at", { ascending: false });
      
      if (cpacaError) throw cpacaError;

      cpacaProcesses?.forEach((p) => {
        options.push({
          id: p.id,
          type: "cpaca",
          radicado: p.radicado,
          label: p.radicado || p.titulo || "Sin radicado",
          clientName: p.client?.name || null,
          category: "Proceso CPACA",
          icon: "building",
        });
      });

      return options;
    },
  });

  // Group options by category for the dropdown
  const groupedOptions = useMemo(() => {
    if (!processOptions) return {};
    
    return processOptions.reduce((acc, opt) => {
      if (!acc[opt.category]) {
        acc[opt.category] = [];
      }
      acc[opt.category].push(opt);
      return acc;
    }, {} as Record<string, ProcessOption[]>);
  }, [processOptions]);

  // Helper to parse process_key
  const parseProcessKey = (key: string): { type: "filing" | "cpaca"; id: string } | null => {
    if (!key) return null;
    const [type, id] = key.split(":");
    if (type === "filing" || type === "cpaca") {
      return { type, id };
    }
    return null;
  };

  // Create hearing mutation
  const createHearing = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const parsed = parseProcessKey(formData.process_key);
      if (!parsed) {
        throw new Error("Debe seleccionar un proceso");
      }

      const scheduledAt = new Date(`${formData.scheduled_at}T${formData.scheduled_time}`);

      const insertData = {
        owner_id: user.id,
        title: formData.title,
        scheduled_at: scheduledAt.toISOString(),
        location: formData.location || null,
        notes: formData.notes || null,
        is_virtual: formData.is_virtual,
        virtual_link: formData.virtual_link || null,
        auto_detected: false,
        filing_id: parsed.type === "filing" ? parsed.id : null,
        cpaca_process_id: parsed.type === "cpaca" ? parsed.id : null,
      };

      const { error } = await supabase.from("hearings").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-hearings"] });
      toast.success("Audiencia programada");
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Delete hearing mutation
  const deleteHearing = useMutation({
    mutationFn: async (hearingId: string) => {
      const { error } = await supabase
        .from("hearings")
        .delete()
        .eq("id", hearingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-hearings"] });
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
      process_key: "",
    });
  };

  // Filter and group hearings
  const filteredHearings = useMemo(() => {
    if (!hearings) return [];
    
    return hearings.filter(h => {
      // Search across filings and CPACA processes
      const filingMatch = 
        h.filing?.radicado?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.filing?.matter?.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.filing?.client?.name?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const cpacaMatch = 
        h.cpaca_process?.radicado?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.cpaca_process?.titulo?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.cpaca_process?.client?.name?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSearch = searchQuery === "" || 
        h.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        filingMatch ||
        cpacaMatch;
      
      // Filter by process
      if (filterProcess === "all") return matchesSearch;
      
      const parsed = parseProcessKey(filterProcess);
      if (!parsed) return matchesSearch;
      
      if (parsed.type === "filing") {
        return matchesSearch && h.filing_id === parsed.id;
      } else {
        return matchesSearch && h.cpaca_process_id === parsed.id;
      }
    });
  }, [hearings, searchQuery, filterProcess]);

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
              <div className="space-y-2">
                <Label htmlFor="process">Proceso / Radicación</Label>
                <Select
                  value={formData.process_key}
                  onValueChange={(value) => setFormData({ ...formData, process_key: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar proceso..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {Object.entries(groupedOptions).map(([category, options]) => (
                      <SelectGroup key={category}>
                        <SelectLabel className="flex items-center gap-2">
                          {category === "Proceso CGP" && <Scale className="h-3 w-3" />}
                          {category === "Tutela" && <Gavel className="h-3 w-3" />}
                          {category === "Derecho de Petición" && <FileText className="h-3 w-3" />}
                          {category === "Proceso CPACA" && <Building2 className="h-3 w-3" />}
                          {category === "Habeas Corpus" && <Gavel className="h-3 w-3" />}
                          {category}
                        </SelectLabel>
                        {options.map((opt) => (
                          <SelectItem key={`${opt.type}:${opt.id}`} value={`${opt.type}:${opt.id}`}>
                            <div className="flex flex-col">
                              <span className="font-mono text-sm">{opt.label}</span>
                              {opt.clientName && (
                                <span className="text-xs text-muted-foreground">{opt.clientName}</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
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
        <Select value={filterProcess} onValueChange={setFilterProcess}>
          <SelectTrigger className="w-full md:w-[300px]">
            <SelectValue placeholder="Todos los procesos" />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <SelectItem value="all">Todos los procesos</SelectItem>
            {Object.entries(groupedOptions).map(([category, options]) => (
              <SelectGroup key={category}>
                <SelectLabel>{category}</SelectLabel>
                {options.map((opt) => (
                  <SelectItem key={`${opt.type}:${opt.id}`} value={`${opt.type}:${opt.id}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectGroup>
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
                      onDelete={() => deleteHearing.mutate(hearing.id)}
                      isDeleting={deleteHearing.isPending}
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
                      onDelete={() => deleteHearing.mutate(hearing.id)}
                      isDeleting={deleteHearing.isPending}
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
                      onDelete={() => deleteHearing.mutate(hearing.id)}
                      isDeleting={deleteHearing.isPending}
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
  isDeleting: boolean;
  isPast?: boolean;
  showDate?: boolean;
}

function HearingCard({ hearing, onDelete, isDeleting, isPast, showDate }: HearingCardProps) {
  const date = new Date(hearing.scheduled_at);
  
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

          {/* Process info - Filing or CPACA */}
          {hearing.filing && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              {hearing.filing.filing_type === "TUTELA" || hearing.filing.filing_type === "Tutela" ? (
                <Gavel className="h-3 w-3" />
              ) : hearing.filing.filing_type === "PETICION" || hearing.filing.filing_type === "DERECHO_PETICION" ? (
                <FileText className="h-3 w-3" />
              ) : (
                <Scale className="h-3 w-3" />
              )}
              <span className="font-mono">{hearing.filing.radicado || "Sin radicado"}</span>
              {(hearing.filing.client?.name || hearing.filing.matter?.client_name) && (
                <span> • {hearing.filing.client?.name || hearing.filing.matter?.client_name}</span>
              )}
            </p>
          )}
          
          {hearing.cpaca_process && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              <span className="font-mono">{hearing.cpaca_process.radicado || hearing.cpaca_process.titulo || "Sin radicado"}</span>
              {hearing.cpaca_process.client?.name && (
                <span> • {hearing.cpaca_process.client.name}</span>
              )}
              <Badge variant="outline" className="ml-1 text-[10px] py-0">CPACA</Badge>
            </p>
          )}

          {hearing.notes && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{hearing.notes}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
