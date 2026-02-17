import { Inbox, Send, FileText, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { EmailFolder } from "./email-client-types";

const FOLDERS: { key: EmailFolder; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "inbox", label: "Bandeja de entrada", icon: Inbox },
  { key: "sent", label: "Enviados", icon: Send },
  { key: "drafts", label: "Borradores", icon: FileText },
  { key: "trash", label: "Papelera", icon: Trash2 },
];

interface EmailFolderListProps {
  activeFolder: EmailFolder;
  onSelectFolder: (folder: EmailFolder) => void;
  unreadCounts: Record<EmailFolder, number>;
}

export function EmailFolderList({ activeFolder, onSelectFolder, unreadCounts }: EmailFolderListProps) {
  return (
    <nav className="flex-1 overflow-y-auto py-1">
      {FOLDERS.map(({ key, label, icon: Icon }) => {
        const isActive = activeFolder === key;
        const count = unreadCounts[key];
        return (
          <button
            key={key}
            onClick={() => onSelectFolder(key)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
              isActive
                ? "bg-primary/10 text-primary border-l-2 border-primary font-medium"
                : "text-foreground/70 hover:bg-muted/50 border-l-2 border-transparent"
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
            <span className="flex-1 text-left truncate">{label}</span>
            {count > 0 && (
              <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px] font-bold">
                {count}
              </Badge>
            )}
          </button>
        );
      })}
    </nav>
  );
}
