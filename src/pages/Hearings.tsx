import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin, Video, Eye } from "lucide-react";
import { formatDateColombia } from "@/lib/constants";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface HearingRow {
  id: string;
  title: string;
  scheduled_at: string;
  location: string | null;
  is_virtual: boolean;
  virtual_link: string | null;
  notes: string | null;
  work_item_id: string | null;
}

export default function Hearings() {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const now = new Date().toISOString();

  const { data: hearings, isLoading } = useQuery({
    queryKey: ["hearings", tab],
    queryFn: async () => {
      let query = supabase
        .from("hearings")
        .select("id, title, scheduled_at, location, is_virtual, virtual_link, notes, work_item_id")
        .order("scheduled_at", { ascending: tab === "upcoming" });

      if (tab === "upcoming") {
        query = query.gte("scheduled_at", now);
      } else {
        query = query.lt("scheduled_at", now);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data as HearingRow[];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold">Audiencias</h1>
          <p className="text-muted-foreground">Gestiona todas tus audiencias programadas</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "upcoming" | "past")}>
        <TabsList>
          <TabsTrigger value="upcoming">Próximas</TabsTrigger>
          <TabsTrigger value="past">Pasadas</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-6">
          {isLoading ? (
            <p className="text-muted-foreground text-center py-8">Cargando...</p>
          ) : !hearings?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>No hay audiencias {tab === "upcoming" ? "próximas" : "pasadas"}</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {hearings.map((hearing) => (
                <Card key={hearing.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{hearing.title}</CardTitle>
                        {hearing.notes && <CardDescription>{hearing.notes}</CardDescription>}
                      </div>
                      <Badge variant={hearing.is_virtual ? "default" : "secondary"}>
                        {hearing.is_virtual ? "Virtual" : "Presencial"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {formatDateColombia(new Date(hearing.scheduled_at))}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {new Date(hearing.scheduled_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {hearing.location && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {hearing.location}
                        </div>
                      )}
                      {hearing.virtual_link && (
                        <a href={hearing.virtual_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                          <Video className="h-4 w-4" />
                          Enlace virtual
                        </a>
                      )}
                    </div>
                    {hearing.work_item_id && (
                      <div className="mt-3 pt-3 border-t flex items-center justify-end">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/app/work-items/${hearing.work_item_id}`}>
                            <Eye className="h-4 w-4 mr-1" />
                            Ver proceso
                          </Link>
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
