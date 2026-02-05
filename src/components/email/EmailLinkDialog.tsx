import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_COLORS, type EmailEntityType } from "@/lib/email-constants";
import type { InboundMessage, LinkableEntity } from "@/types/email";

interface EmailLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: InboundMessage;
  onSuccess: () => void;
}

// Map entity types to work_items workflow_types
const ENTITY_TO_WORKFLOW: Record<string, string[]> = {
  CGP_CASE: ["CGP", "LABORAL", "PENAL"],
  TUTELA: ["TUTELA"],
  HABEAS_CORPUS: ["TUTELA"],
  PROCESO_ADMINISTRATIVO: ["GOV_PROCEDURE", "CPACA"],
};

export function EmailLinkDialog({ open, onOpenChange, message, onSuccess }: EmailLinkDialogProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<EmailEntityType>("CLIENT");
  const { toast } = useToast();

  const { data: entities, isLoading } = useQuery({
    queryKey: ["linkable-entities", activeTab, search],
    queryFn: async () => {
      const results: LinkableEntity[] = [];

      if (activeTab === "CLIENT") {
        const { data } = await (supabase
          .from("clients")
          .select("id, name, email, id_number")
          .eq("email_linking_enabled", true)
          .ilike("name", `%${search}%`)
          .limit(20) as any);
        
        if (data) {
          results.push(...data.map(c => ({
            id: c.id,
            type: "CLIENT" as EmailEntityType,
            name: c.name,
            details: c.email || c.id_number || undefined,
          })));
        }
      } else {
        // Search work_items by workflow_type
        const workflowTypes = ENTITY_TO_WORKFLOW[activeTab] || [];
        
        if (workflowTypes.length === 0) return results;
        
        let query = (supabase
          .from("work_items")
          .select("id, workflow_type, radicado, authority_name, demandantes")
          .eq("email_linking_enabled", true)
          .in("workflow_type", workflowTypes as any)
          .limit(20)) as any;

        if (search) {
          query = query.or(`radicado.ilike.%${search}%,demandantes.ilike.%${search}%,authority_name.ilike.%${search}%`);
        }

        const { data } = await query;
        
        if (data) {
          results.push(...data.map((w: any) => ({
            id: w.id,
            type: activeTab,
            name: w.radicado || `${w.workflow_type} - ${w.demandantes || "Sin partes"}`,
            details: w.authority_name || undefined,
          })));
        }
      }

      return results;
    },
    enabled: open,
  });

  const createLinkMutation = useMutation({
    mutationFn: async (entity: LinkableEntity) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");

      const { error } = await supabase
        .from("message_links")
        .insert({
          message_id: message.id,
          owner_id: user.id,
          entity_type: entity.type,
          entity_id: entity.id,
          link_status: "MANUALLY_LINKED",
          link_confidence: 1.0,
          link_reasons: ["Vinculado manualmente por el usuario"],
          created_by: "USER",
        });

      if (error) throw error;

      // Update message status if not already linked
      await supabase
        .from("inbound_messages")
        .update({ processing_status: "LINKED" })
        .eq("id", message.id);
    },
    onSuccess: () => {
      toast({ title: "Mensaje vinculado exitosamente" });
      onSuccess();
    },
    onError: (error) => {
      toast({ 
        title: "Error al vincular", 
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive" 
      });
    },
  });

  const entityTypes: EmailEntityType[] = ["CLIENT", "CGP_CASE", "TUTELA", "HABEAS_CORPUS", "PROCESO_ADMINISTRATIVO"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Vincular mensaje</DialogTitle>
          <DialogDescription>
            Selecciona la entidad a la que deseas vincular este mensaje.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Message preview */}
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <p className="font-medium">{message.subject}</p>
            <p className="text-muted-foreground text-xs">
              De: {message.from_name || message.from_email}
            </p>
          </div>

          {/* Entity type tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EmailEntityType)}>
            <TabsList className="grid grid-cols-5 w-full">
              {entityTypes.map((type) => (
                <TabsTrigger key={type} value={type} className="text-xs px-2">
                  {ENTITY_TYPE_LABELS[type].replace("Proceso ", "")}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="mt-4">
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={`Buscar ${ENTITY_TYPE_LABELS[activeTab].toLowerCase()}...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Results */}
              <ScrollArea className="h-[300px]">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : entities?.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No se encontraron resultados
                  </p>
                ) : (
                  <div className="space-y-2">
                    {entities?.map((entity) => (
                      <button
                        key={entity.id}
                        onClick={() => createLinkMutation.mutate(entity)}
                        disabled={createLinkMutation.isPending}
                        className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors disabled:opacity-50"
                      >
                        <div className="flex items-center gap-2">
                          <Badge className={`${ENTITY_TYPE_COLORS[entity.type]} text-white text-xs`}>
                            {ENTITY_TYPE_LABELS[entity.type]}
                          </Badge>
                          <span className="font-medium">{entity.name}</span>
                        </div>
                        {entity.details && (
                          <p className="text-xs text-muted-foreground mt-1">{entity.details}</p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
