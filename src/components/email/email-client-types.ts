export type EmailFolder = "inbox" | "sent" | "drafts" | "trash";

export interface MockEmail {
  id: string;
  folder: EmailFolder;
  from: { name: string; email: string };
  to: string[];
  cc?: string[];
  subject: string;
  preview: string;
  htmlBody: string;
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
  attachments?: { name: string; size: string }[];
}
