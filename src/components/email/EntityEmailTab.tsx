import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Mail, Paperclip, ExternalLink, ToggleLeft, ToggleRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { ENTITY_TYPE_LABELS, type EmailEntityType } from "@/lib/email-constants";
import type { InboundMessage, MessageLink, InboundAttachment } from "@/types/email";

interface EntityEmailTabProps {
  entityType: EmailEntityType;
  entityId: string;
  entityTable: "clients" | "filings" | "monitored_processes";
  emailLinkingEnabled: boolean;
}

interface LinkedMessage extends InboundMessage {
  inbound_attachments: InboundAttachment[];
}

interface MessageLinkWithMessage extends MessageLink {
  inbound_messages: LinkedMessage;
}

export function EntityEmailTab({ 
  entityType, 
  entityId, 
  entityTable, 
  emailLinkingEnabled 
}: EntityEmailTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: linkedMessages, isLoading } = useQuery({
    queryKey: ["entity-emails", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_links")
        .select(`
          *,
          inbound_messages (
            *,
            inbound_attachments (*)
          )
        `)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .neq("link_status", "DISMISSED")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MessageLinkWithMessage[];
    },
  });

  const toggleLinkingMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from(entityTable)
        .update({ email_linking_enabled: enabled })
        .eq("id", entityId);
      
      if (error) throw error;
    },
    onSuccess: (_, enabled) => {
      toast({ 
        title: enabled ? "Vinculación de emails activada" : "Vinculación de emails desactivada" 
      });
      queryClient.invalidateQueries({ queryKey: [entityTable, entityId] });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive" 
      });
    },
  });

  return (
    <div className="space-y-4">
      {/* Toggle setting */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="email-linking">Vinculación automática de emails</Label>
              <p className="text-xs text-muted-foreground">
                Permite que los emails entrantes se vinculen automáticamente a este {ENTITY_TYPE_LABELS[entityType].toLowerCase()}
              </p>
            </div>
            <Switch
              id="email-linking"
              checked={emailLinkingEnabled}
              onCheckedChange={(checked) => toggleLinkingMutation.mutate(checked)}
              disabled={toggleLinkingMutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

      {/* Linked emails list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Emails vinculados
          </CardTitle>
          <CardDescription>
            {linkedMessages?.length || 0} email{(linkedMessages?.length || 0) !== 1 ? "s" : ""} vinculado{(linkedMessages?.length || 0) !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : linkedMessages?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="mx-auto h-10 w-10 mb-2 opacity-50" />
              <p>No hay emails vinculados</p>
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {linkedMessages?.map((link) => {
                  const msg = link.inbound_messages;
                  if (!msg) return null;
                  
                  return (
                    <div 
                      key={link.id}
                      className="p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">
                              {msg.from_name || msg.from_email}
                            </span>
                            {msg.inbound_attachments?.length > 0 && (
                              <Paperclip className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-sm font-medium truncate">{msg.subject}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {msg.body_preview}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(msg.received_at), "dd MMM, HH:mm", { locale: es })}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {link.link_status === "AUTO_LINKED" ? "Auto" : "Manual"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
