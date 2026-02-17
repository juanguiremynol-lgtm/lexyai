import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MockEmail } from "./email-client-types";

interface EmailListProps {
  emails: MockEmail[];
  selectedId: string | null;
  readIds: Set<string>;
  onSelect: (email: MockEmail) => void;
}

export function EmailList({ emails, selectedId, readIds, onSelect }: EmailListProps) {
  if (emails.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        No hay emails en esta carpeta
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      {emails.map((email) => {
        const isSelected = email.id === selectedId;
        const isUnread = !email.isRead && !readIds.has(email.id);

        return (
          <button
            key={email.id}
            onClick={() => onSelect(email)}
            className={cn(
              "w-full text-left px-4 py-3 border-b border-border transition-colors",
              isSelected
                ? "bg-primary/10 border-l-2 border-l-primary"
                : "hover:bg-muted/40 border-l-2 border-l-transparent",
              isUnread && "bg-muted/20"
            )}
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className={cn("text-sm truncate max-w-[70%]", isUnread && "font-semibold text-foreground")}>
                {email.from.name}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                {format(new Date(email.date), "dd MMM", { locale: es })}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <p className={cn("text-sm truncate flex-1", isUnread ? "font-medium" : "text-foreground/80")}>
                {email.subject}
              </p>
              {email.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{email.preview}</p>
          </button>
        );
      })}
    </ScrollArea>
  );
}
