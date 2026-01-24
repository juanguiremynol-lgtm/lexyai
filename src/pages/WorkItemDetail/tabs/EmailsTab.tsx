/**
 * Emails Tab - Shows linked emails for the work item
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Mail, 
  Paperclip,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

import type { WorkItem } from "@/types/work-item";

interface EmailsTabProps {
  workItem: WorkItem & { _source?: string };
}

interface LinkedEmail {
  id: string;
  inbound_messages: {
    id: string;
    from_address: string;
    from_name: string | null;
    subject: string | null;
    body_text: string | null;
    received_at: string;
    inbound_attachments: {
      id: string;
      filename: string;
      file_path: string | null;
    }[];
  };
}

export function EmailsTab({ workItem }: EmailsTabProps) {
  const queryClient = useQueryClient();
  const source = (workItem as any)._source;

  // Determine which table and entity type to use
  const getEntityConfig = () => {
    if (source === "work_items") {
      return { entityType: "work_item", entityId: workItem.id, table: "work_items" };
    }
    if (source === "cgp_items" || workItem.legacy_cgp_item_id) {
      return { entityType: "cgp_item", entityId: workItem.legacy_cgp_item_id || workItem.id, table: "cgp_items" };
    }
    if (source === "monitored_processes" || workItem.legacy_process_id) {
      return { entityType: "monitored_process", entityId: workItem.legacy_process_id || workItem.id, table: "monitored_processes" };
    }
    if (workItem.legacy_filing_id) {
      return { entityType: "filing", entityId: workItem.legacy_filing_id, table: "filings" };
    }
    return { entityType: "work_item", entityId: workItem.id, table: "work_items" };
  };

  const entityConfig = getEntityConfig();

  // Fetch linked emails
  const { data: linkedEmails, isLoading } = useQuery({
    queryKey: ["work-item-emails", workItem.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_links")
        .select(`
          id,
          inbound_messages (
            id,
            sender,
            subject,
            body_preview,
            received_at,
            inbound_attachments (
              id,
              filename,
              file_path
            )
          )
        `)
        .eq("entity_type", entityConfig.entityType)
        .eq("entity_id", entityConfig.entityId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      // Map database fields to component interface
      return (data || []).map((d: any) => ({
        id: d.id,
        inbound_messages: d.inbound_messages ? {
          id: d.inbound_messages.id,
          from_address: d.inbound_messages.sender || "",
          from_name: null,
          subject: d.inbound_messages.subject,
          body_text: d.inbound_messages.body_preview,
          received_at: d.inbound_messages.received_at,
          inbound_attachments: d.inbound_messages.inbound_attachments || [],
        } : null,
      })).filter((d: any) => d.inbound_messages) as LinkedEmail[];
    },
    enabled: !!entityConfig.entityId,
  });

  // Toggle email linking mutation
  const toggleEmailLinkingMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from(entityConfig.table as any)
        .update({ email_linking_enabled: enabled })
        .eq("id", entityConfig.entityId);

      if (error) throw error;
    },
    onSuccess: (_, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      toast.success(enabled ? "Vinculación de correos activada" : "Vinculación de correos desactivada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Settings card */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-base">Vinculación Automática de Correos</Label>
              <p className="text-sm text-muted-foreground">
                Vincular automáticamente correos entrantes que mencionen este asunto
              </p>
            </div>
            <Switch
              checked={workItem.email_linking_enabled}
              onCheckedChange={(checked) => toggleEmailLinkingMutation.mutate(checked)}
              disabled={toggleEmailLinkingMutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

      {/* Emails header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Correos Vinculados
            <Badge variant="secondary" className="ml-auto">
              {linkedEmails?.length || 0} correos
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      {!linkedEmails || linkedEmails.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin correos vinculados</h3>
              <p className="text-muted-foreground text-sm">
                {workItem.email_linking_enabled
                  ? "Los correos relacionados aparecerán aquí cuando sean detectados."
                  : "Active la vinculación automática para detectar correos relacionados."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {linkedEmails.map((link) => {
            const email = link.inbound_messages;
            const attachments = email.inbound_attachments || [];

            return (
              <Card key={link.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {email.from_name || email.from_address}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {email.from_address}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(email.received_at), "d MMM yyyy, HH:mm", { locale: es })}
                      </div>
                    </div>

                    {/* Subject */}
                    {email.subject && (
                      <p className="font-medium">{email.subject}</p>
                    )}

                    {/* Body preview */}
                    {email.body_text && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {email.body_text}
                      </p>
                    )}

                    {/* Attachments */}
                    {attachments.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        {attachments.map((att) => (
                          <Badge key={att.id} variant="outline" className="text-xs">
                            {att.filename}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
