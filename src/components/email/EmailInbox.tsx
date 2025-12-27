import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Mail, Paperclip, Check, X, Link2, Search, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { INBOX_TABS, ENTITY_TYPE_LABELS, ENTITY_TYPE_COLORS, LINK_STATUS_COLORS } from "@/lib/email-constants";
import type { InboundMessage, MessageLink, InboundAttachment } from "@/types/email";
import { EmailMessageCard } from "./EmailMessageCard";
import { EmailLinkDialog } from "./EmailLinkDialog";

interface InboundMessageWithLinks extends InboundMessage {
  message_links: MessageLink[];
  inbound_attachments: InboundAttachment[];
}

export function EmailInbox() {
  const [activeTab, setActiveTab] = useState<string>("needs_review");
  const [search, setSearch] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<InboundMessageWithLinks | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useQuery({
    queryKey: ["inbound-messages", activeTab],
    queryFn: async () => {
      let query = supabase
        .from("inbound_messages")
        .select(`
          *,
          message_links (*),
          inbound_attachments (*)
        `)
        .order("received_at", { ascending: false });

      if (activeTab === "needs_review") {
        // Messages with no links or only suggested links
        query = query.or("processing_status.eq.NORMALIZED,processing_status.eq.RECEIVED");
      } else if (activeTab === "linked") {
        query = query.eq("processing_status", "LINKED");
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as InboundMessageWithLinks[];
    },
  });

  const confirmLinkMutation = useMutation({
    mutationFn: async ({ linkId }: { linkId: string }) => {
      const { error } = await supabase
        .from("message_links")
        .update({ link_status: "MANUALLY_LINKED", created_by: "USER" })
        .eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Vínculo confirmado" });
      queryClient.invalidateQueries({ queryKey: ["inbound-messages"] });
    },
  });

  const dismissLinkMutation = useMutation({
    mutationFn: async ({ linkId }: { linkId: string }) => {
      const { error } = await supabase
        .from("message_links")
        .update({ link_status: "DISMISSED", dismissed_at: new Date().toISOString() })
        .eq("id", linkId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Sugerencia descartada" });
      queryClient.invalidateQueries({ queryKey: ["inbound-messages"] });
    },
  });

  const filteredMessages = messages?.filter(msg => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      msg.subject.toLowerCase().includes(searchLower) ||
      msg.from_email.toLowerCase().includes(searchLower) ||
      msg.from_name?.toLowerCase().includes(searchLower) ||
      msg.body_preview?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Bandeja de Entrada
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search and filters */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por asunto, remitente..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                {INBOX_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                    {tab.value === "needs_review" && messages && (
                      <Badge variant="secondary" className="ml-2">
                        {messages.filter(m => 
                          m.processing_status === "NORMALIZED" || 
                          m.processing_status === "RECEIVED"
                        ).length}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeTab} className="mt-4">
                <ScrollArea className="h-[600px]">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                    </div>
                  ) : filteredMessages?.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Mail className="mx-auto h-12 w-12 mb-2 opacity-50" />
                      <p>No hay mensajes en esta vista</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredMessages?.map((message) => (
                        <EmailMessageCard
                          key={message.id}
                          message={message}
                          onConfirmLink={(linkId) => confirmLinkMutation.mutate({ linkId })}
                          onDismissLink={(linkId) => dismissLinkMutation.mutate({ linkId })}
                          onManualLink={() => {
                            setSelectedMessage(message);
                            setLinkDialogOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Manual link dialog */}
      {selectedMessage && (
        <EmailLinkDialog
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
          message={selectedMessage}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["inbound-messages"] });
            setLinkDialogOpen(false);
            setSelectedMessage(null);
          }}
        />
      )}
    </div>
  );
}
