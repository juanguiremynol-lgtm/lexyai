import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Save, Download, Plus, Trash2, Clock, FileText, Mail, Plug, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import type { RepartoEntry } from "@/types/database";
import { IcarusIntegration } from "@/components/settings/IcarusIntegration";
import { EstadosImport } from "@/components/estados";

export default function Settings() {
  const queryClient = useQueryClient();
  const [newReparto, setNewReparto] = useState<RepartoEntry>({
    city: "",
    circuit: "",
    email: "",
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const updateProfile = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Configuración guardada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleProfileSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateProfile.mutate({
      full_name: form.get("full_name"),
      firm_name: form.get("firm_name"),
      signature_block: form.get("signature_block"),
    });
  };

  const handleSlaSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    updateProfile.mutate({
      sla_receipt_hours: parseInt(form.get("sla_receipt_hours") as string) || 24,
      sla_acta_days: parseInt(form.get("sla_acta_days") as string) || 5,
      sla_court_reply_days: parseInt(form.get("sla_court_reply_days") as string) || 3,
    });
  };

  const addRepartoEntry = () => {
    if (!newReparto.city || !newReparto.email) {
      toast.error("Ciudad y correo son requeridos");
      return;
    }

    const currentDirectory = (profile?.reparto_directory as unknown as RepartoEntry[]) || [];
    const updated = [...currentDirectory, newReparto];
    
    updateProfile.mutate({ reparto_directory: updated });
    setNewReparto({ city: "", circuit: "", email: "" });
  };

  const removeRepartoEntry = (index: number) => {
    const currentDirectory = (profile?.reparto_directory as unknown as RepartoEntry[]) || [];
    const updated = currentDirectory.filter((_, i) => i !== index);
    updateProfile.mutate({ reparto_directory: updated });
  };

  const exportIcarus = async () => {
    const { data, error } = await supabase
      .from("filings")
      .select(`
        radicado,
        court_name,
        filing_type,
        updated_at,
        matter:matters(client_name, matter_name)
      `)
      .in("status", ["RADICADO_CONFIRMED", "ICARUS_SYNC_PENDING"])
      .not("radicado", "is", null);

    if (error) {
      toast.error("Error al exportar: " + error.message);
      return;
    }

    if (!data || data.length === 0) {
      toast.info("No hay radicados para exportar");
      return;
    }

    const csvContent = [
      ["Radicado", "Juzgado", "Cliente", "Asunto", "Tipo", "Fecha Confirmación"].join(","),
      ...data.map((f) => {
        const matter = f.matter as { client_name: string; matter_name: string } | null;
        return [
          f.radicado,
          `"${f.court_name || ""}"`,
          `"${matter?.client_name || ""}"`,
          `"${matter?.matter_name || ""}"`,
          f.filing_type,
          new Date(f.updated_at).toLocaleDateString("es-CO"),
        ].join(",");
      }),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `icarus_export_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("Archivo CSV descargado");
  };

  const repartoDirectory = (profile?.reparto_directory as unknown as RepartoEntry[]) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">Configuración</h1>
        <p className="text-muted-foreground">
          Gestiona tu perfil y preferencias
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="sla">SLAs</TabsTrigger>
          <TabsTrigger value="reparto">Directorio Reparto</TabsTrigger>
          <TabsTrigger value="estados">Estados</TabsTrigger>
          <TabsTrigger value="integrations">Integraciones</TabsTrigger>
          <TabsTrigger value="export">Exportar</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Información Personal</CardTitle>
              <CardDescription>
                Configura tu nombre y firma para los correos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleProfileSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Nombre Completo</Label>
                    <Input
                      id="full_name"
                      name="full_name"
                      defaultValue={profile?.full_name || ""}
                      placeholder="Dr. Juan Pérez"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="firm_name">Nombre de la Firma</Label>
                    <Input
                      id="firm_name"
                      name="firm_name"
                      defaultValue={profile?.firm_name || ""}
                      placeholder="Pérez & Asociados"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signature_block">Bloque de Firma</Label>
                  <Textarea
                    id="signature_block"
                    name="signature_block"
                    defaultValue={profile?.signature_block || ""}
                    placeholder="Dr. Juan Pérez&#10;Abogado&#10;Pérez & Asociados&#10;Tel: (1) 234-5678"
                    className="min-h-[120px]"
                  />
                  <p className="text-sm text-muted-foreground">
                    Este texto se insertará en las plantillas de correo como {"{{signature_block}}"}
                  </p>
                </div>
                <Button type="submit" disabled={updateProfile.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  Guardar Perfil
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sla">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Configuración de SLAs
              </CardTitle>
              <CardDescription>
                Define los tiempos límite para cada etapa del proceso
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSlaSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="sla_receipt_hours">
                      Recibo de Reparto (horas)
                    </Label>
                    <Input
                      id="sla_receipt_hours"
                      name="sla_receipt_hours"
                      type="number"
                      min="1"
                      defaultValue={profile?.sla_receipt_hours || 24}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tiempo para confirmar recibo del correo a reparto
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sla_acta_days">
                      Acta de Reparto (días)
                    </Label>
                    <Input
                      id="sla_acta_days"
                      name="sla_acta_days"
                      type="number"
                      min="1"
                      defaultValue={profile?.sla_acta_days || 5}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tiempo para recibir el acta de reparto
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sla_court_reply_days">
                      Respuesta del Juzgado (días)
                    </Label>
                    <Input
                      id="sla_court_reply_days"
                      name="sla_court_reply_days"
                      type="number"
                      min="1"
                      defaultValue={profile?.sla_court_reply_days || 3}
                    />
                    <p className="text-xs text-muted-foreground">
                      Tiempo para respuesta del juzgado asignado
                    </p>
                  </div>
                </div>
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <strong>Nota:</strong> Los SLAs se calculan en días calendario. 
                    Una futura versión incluirá el calendario de días hábiles de Colombia.
                  </p>
                </div>
                <Button type="submit" disabled={updateProfile.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  Guardar SLAs
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reparto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Directorio de Reparto
              </CardTitle>
              <CardDescription>
                Configura los correos de reparto por ciudad/circuito
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-2">
                  <Label>Ciudad</Label>
                  <Input
                    value={newReparto.city}
                    onChange={(e) =>
                      setNewReparto({ ...newReparto, city: e.target.value })
                    }
                    placeholder="Bogotá"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Circuito (opcional)</Label>
                  <Input
                    value={newReparto.circuit}
                    onChange={(e) =>
                      setNewReparto({ ...newReparto, circuit: e.target.value })
                    }
                    placeholder="Civil"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Correo Electrónico</Label>
                  <Input
                    type="email"
                    value={newReparto.email}
                    onChange={(e) =>
                      setNewReparto({ ...newReparto, email: e.target.value })
                    }
                    placeholder="repartocivilbog@cendoj.ramajudicial.gov.co"
                  />
                </div>
                <Button onClick={addRepartoEntry}>
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar
                </Button>
              </div>

              <Separator />

              {repartoDirectory.length === 0 ? (
                <div className="text-center py-8">
                  <Mail className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-2 text-muted-foreground">
                    No hay entradas en el directorio
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {repartoDirectory.map((entry, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-4">
                        <div>
                          <p className="font-medium">{entry.city}</p>
                          {entry.circuit && (
                            <Badge variant="outline" className="text-xs">
                              {entry.circuit}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {entry.email}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRepartoEntry(index)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="estados">
          <EstadosImport />
        </TabsContent>

        <TabsContent value="integrations">
          <IcarusIntegration />
        </TabsContent>

        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Exportar para Icarus
              </CardTitle>
              <CardDescription>
                Descarga los radicados confirmados en formato CSV
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Este archivo incluye todas las radicaciones con estado{" "}
                <Badge variant="outline">RADICADO_CONFIRMED</Badge> o{" "}
                <Badge variant="outline">ICARUS_SYNC_PENDING</Badge> que tengan
                un número de radicado asignado.
              </p>
              <Button onClick={exportIcarus}>
                <Download className="h-4 w-4 mr-2" />
                Descargar CSV
              </Button>

              <Separator className="my-6" />

              <div className="space-y-4">
                <h3 className="font-medium">Roadmap v2</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">📧 Integración Gmail/Outlook</h4>
                    <p className="text-sm text-muted-foreground">
                      Recepción automática de correos y clasificación de actas
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">📄 OCR de Actas</h4>
                    <p className="text-sm text-muted-foreground">
                      Extracción automática de radicado y juzgado del PDF
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">📅 Calendario Colombiano</h4>
                    <p className="text-sm text-muted-foreground">
                      SLAs calculados en días hábiles con festivos
                    </p>
                  </div>
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium mb-2">🏛️ Directorio de Juzgados</h4>
                    <p className="text-sm text-muted-foreground">
                      Base de datos de juzgados por circuito con correos
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
