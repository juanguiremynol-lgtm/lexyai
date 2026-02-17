/**
 * EmailClientPage — Full three-pane email client UI.
 * Left: folder list, Center: email list, Right: email detail.
 * Uses mock data for now; wired to edge function proxy later.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { EmailFolderList } from "./EmailFolderList";
import { EmailList } from "./EmailListPane";
import { EmailDetail } from "./EmailDetailPane";
import { EmailComposeDialog } from "./EmailComposeDialog";
import { Button } from "@/components/ui/button";
import { PenSquare, ArrowLeft } from "lucide-react";
import type { MockEmail, EmailFolder } from "./email-client-types";
import { MOCK_EMAILS } from "./email-mock-data";

export function EmailClientPage() {
  const isMobile = useIsMobile();
  const [activeFolder, setActiveFolder] = useState<EmailFolder>("inbox");
  const [selectedEmail, setSelectedEmail] = useState<MockEmail | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Mobile navigation state: "folders" | "list" | "detail"
  const [mobileView, setMobileView] = useState<"folders" | "list" | "detail">("list");

  const folderEmails = MOCK_EMAILS.filter((e) => e.folder === activeFolder);
  const unreadCounts: Record<EmailFolder, number> = {
    inbox: MOCK_EMAILS.filter((e) => e.folder === "inbox" && !e.isRead && !readIds.has(e.id)).length,
    sent: 0,
    drafts: MOCK_EMAILS.filter((e) => e.folder === "drafts").length,
    trash: MOCK_EMAILS.filter((e) => e.folder === "trash").length,
  };

  const handleSelectEmail = (email: MockEmail) => {
    setSelectedEmail(email);
    setReadIds((prev) => new Set(prev).add(email.id));
    if (isMobile) setMobileView("detail");
  };

  const handleFolderChange = (folder: EmailFolder) => {
    setActiveFolder(folder);
    setSelectedEmail(null);
    if (isMobile) setMobileView("list");
  };

  // Mobile: single pane flow
  if (isMobile) {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {/* Compose FAB */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          {mobileView !== "list" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileView(mobileView === "detail" ? "list" : "folders")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <h2 className="font-semibold flex-1 capitalize">{activeFolder}</h2>
          <Button size="sm" onClick={() => setComposeOpen(true)}>
            <PenSquare className="h-4 w-4 mr-1" /> Componer
          </Button>
        </div>

        {mobileView === "folders" && (
          <EmailFolderList
            activeFolder={activeFolder}
            onSelectFolder={handleFolderChange}
            unreadCounts={unreadCounts}
          />
        )}
        {mobileView === "list" && (
          <EmailList
            emails={folderEmails}
            selectedId={selectedEmail?.id ?? null}
            readIds={readIds}
            onSelect={handleSelectEmail}
          />
        )}
        {mobileView === "detail" && selectedEmail && (
          <EmailDetail email={selectedEmail} onBack={() => setMobileView("list")} />
        )}

        <EmailComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
      </div>
    );
  }

  // Desktop: three-pane
  return (
    <div className="flex h-[calc(100vh-8rem)] border border-border rounded-lg overflow-hidden bg-background">
      {/* Left: Folders */}
      <div className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="p-3">
          <Button className="w-full" onClick={() => setComposeOpen(true)}>
            <PenSquare className="h-4 w-4 mr-2" /> Componer
          </Button>
        </div>
        <EmailFolderList
          activeFolder={activeFolder}
          onSelectFolder={handleFolderChange}
          unreadCounts={unreadCounts}
        />
      </div>

      {/* Center: Email list */}
      <div className="w-80 border-r border-border flex flex-col shrink-0 min-w-0">
        <EmailList
          emails={folderEmails}
          selectedId={selectedEmail?.id ?? null}
          readIds={readIds}
          onSelect={handleSelectEmail}
        />
      </div>

      {/* Right: Detail */}
      <div className="flex-1 min-w-0">
        {selectedEmail ? (
          <EmailDetail email={selectedEmail} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Selecciona un email para ver su contenido
          </div>
        )}
      </div>

      <EmailComposeDialog open={composeOpen} onOpenChange={setComposeOpen} />
    </div>
  );
}
