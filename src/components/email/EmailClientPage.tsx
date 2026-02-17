/**
 * EmailClientPage — Full three-pane email client UI.
 * Left: folder list, Center: email list, Right: email detail.
 *
 * WIRED: Inbox reads from `inbound_messages`, Sent reads from `email_outbox`,
 * Compose enqueues to `email_outbox` → `process-email-outbox` sends via active provider.
 * Falls back to mock data when no live data is available.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { EmailFolderList } from "./EmailFolderList";
import { EmailList } from "./EmailListPane";
import { EmailDetail } from "./EmailDetailPane";
import { EmailComposeDialog } from "./EmailComposeDialog";
import { Button } from "@/components/ui/button";
import { PenSquare, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { MockEmail, EmailFolder } from "./email-client-types";
import { MOCK_EMAILS } from "./email-mock-data";
import {
  fetchInboxEmails,
  fetchSentEmails,
  PLATFORM_EMAIL,
  type InboxEmail,
  type SentEmail,
} from "@/lib/email/email-client-service";

/** Convert inbound_messages row → MockEmail shape for the UI */
function inboundToMockEmail(msg: InboxEmail): MockEmail {
  return {
    id: msg.id,
    folder: "inbox",
    from: { name: msg.from_name || msg.from_email, email: msg.from_email },
    to: msg.to_emails || [PLATFORM_EMAIL],
    subject: msg.subject,
    preview: msg.body_preview || msg.text_body?.substring(0, 120) || "",
    htmlBody: msg.html_body || `<p>${msg.text_body || ""}</p>`,
    date: msg.received_at,
    isRead: msg.processing_status !== "NEW",
    hasAttachments: false,
    cc: msg.cc_emails || undefined,
  };
}

/** Convert email_outbox row → MockEmail shape for the UI */
function sentToMockEmail(msg: SentEmail): MockEmail {
  return {
    id: msg.id,
    folder: "sent",
    from: { name: "Andromeda Legal", email: PLATFORM_EMAIL },
    to: [msg.to_email],
    subject: msg.subject,
    preview: msg.html.replace(/<[^>]*>/g, "").substring(0, 120),
    htmlBody: msg.html,
    date: msg.sent_at || msg.created_at,
    isRead: true,
    hasAttachments: false,
  };
}

export function EmailClientPage() {
  const isMobile = useIsMobile();
  const [activeFolder, setActiveFolder] = useState<EmailFolder>("inbox");
  const [selectedEmail, setSelectedEmail] = useState<MockEmail | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [mobileView, setMobileView] = useState<"folders" | "list" | "detail">("list");

  // Live data queries
  const { data: inboxData, isLoading: inboxLoading, refetch: refetchInbox } = useQuery({
    queryKey: ["email-client-inbox"],
    queryFn: () => fetchInboxEmails(100),
    staleTime: 30_000,
  });

  const { data: sentData, isLoading: sentLoading, refetch: refetchSent } = useQuery({
    queryKey: ["email-client-sent"],
    queryFn: () => fetchSentEmails(100),
    staleTime: 30_000,
  });

  // Merge live data with mock fallback
  const liveInbox = useMemo(() => inboxData?.data?.map(inboundToMockEmail) ?? [], [inboxData]);
  const liveSent = useMemo(() => sentData?.data?.map(sentToMockEmail) ?? [], [sentData]);

  const allEmails = useMemo(() => {
    const inbox = liveInbox.length > 0 ? liveInbox : MOCK_EMAILS.filter((e) => e.folder === "inbox");
    const sent = liveSent.length > 0 ? liveSent : MOCK_EMAILS.filter((e) => e.folder === "sent");
    const drafts = MOCK_EMAILS.filter((e) => e.folder === "drafts");
    const trash = MOCK_EMAILS.filter((e) => e.folder === "trash");
    return [...inbox, ...sent, ...drafts, ...trash];
  }, [liveInbox, liveSent]);

  const folderEmails = allEmails.filter((e) => e.folder === activeFolder);
  const isLoading = (activeFolder === "inbox" && inboxLoading) || (activeFolder === "sent" && sentLoading);

  const unreadCounts: Record<EmailFolder, number> = {
    inbox: allEmails.filter((e) => e.folder === "inbox" && !e.isRead && !readIds.has(e.id)).length,
    sent: 0,
    drafts: allEmails.filter((e) => e.folder === "drafts").length,
    trash: allEmails.filter((e) => e.folder === "trash").length,
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

  const handleSent = () => {
    refetchSent();
    refetchInbox();
  };

  const LoadingSkeleton = () => (
    <div className="p-3 space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );

  // Mobile: single pane flow
  if (isMobile) {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
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
          <EmailFolderList activeFolder={activeFolder} onSelectFolder={handleFolderChange} unreadCounts={unreadCounts} />
        )}
        {mobileView === "list" && (isLoading ? <LoadingSkeleton /> : (
          <EmailList emails={folderEmails} selectedId={selectedEmail?.id ?? null} readIds={readIds} onSelect={handleSelectEmail} />
        ))}
        {mobileView === "detail" && selectedEmail && (
          <EmailDetail email={selectedEmail} onBack={() => setMobileView("list")} />
        )}

        <EmailComposeDialog open={composeOpen} onOpenChange={setComposeOpen} onSent={handleSent} />
      </div>
    );
  }

  // Desktop: three-pane
  return (
    <div className="flex h-[calc(100vh-8rem)] border border-border rounded-lg overflow-hidden bg-background">
      <div className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="p-3">
          <Button className="w-full" onClick={() => setComposeOpen(true)}>
            <PenSquare className="h-4 w-4 mr-2" /> Componer
          </Button>
        </div>
        <EmailFolderList activeFolder={activeFolder} onSelectFolder={handleFolderChange} unreadCounts={unreadCounts} />
      </div>

      <div className="w-80 border-r border-border flex flex-col shrink-0 min-w-0">
        {isLoading ? <LoadingSkeleton /> : (
          <EmailList emails={folderEmails} selectedId={selectedEmail?.id ?? null} readIds={readIds} onSelect={handleSelectEmail} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        {selectedEmail ? (
          <EmailDetail email={selectedEmail} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Selecciona un email para ver su contenido
          </div>
        )}
      </div>

      <EmailComposeDialog open={composeOpen} onOpenChange={setComposeOpen} onSent={handleSent} />
    </div>
  );
}
