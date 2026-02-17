/**
 * PlatformEmailConsoleTab — Main console assembling Inbox, Sent, and Compose
 */

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Inbox, SendHorizonal, PenSquare } from "lucide-react";
import { InboxView } from "./InboxView";
import { SentView } from "./SentView";
import { ComposeDialog } from "./ComposeDialog";

export function PlatformEmailConsoleTab() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("inbox");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Console</h1>
          <p className="text-muted-foreground text-sm">
            Bandeja unificada de emails entrantes y enviados — uso exclusivo de plataforma.
          </p>
        </div>
        <Button onClick={() => setComposeOpen(true)}>
          <PenSquare className="h-4 w-4 mr-2" /> Componer
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5">
            <Inbox className="h-4 w-4" /> Bandeja de Entrada
          </TabsTrigger>
          <TabsTrigger value="sent" className="gap-1.5">
            <SendHorizonal className="h-4 w-4" /> Enviados
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <InboxView />
        </TabsContent>
        <TabsContent value="sent">
          <SentView />
        </TabsContent>
      </Tabs>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSent={() => setActiveTab("sent")}
      />
    </div>
  );
}
