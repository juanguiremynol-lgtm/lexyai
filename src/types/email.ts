import type { EmailEntityType, EmailLinkStatus, EmailProcessingStatus } from "@/lib/email-constants";

export interface InboundMessage {
  id: string;
  owner_id: string;
  received_at: string;
  source_provider: string;
  source_message_id: string | null;
  from_name: string | null;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  date_header: string | null;
  text_body: string | null;
  html_body: string | null;
  body_preview: string | null;
  thread_id: string | null;
  references_header: string[] | null;
  in_reply_to: string | null;
  raw_payload_hash: string;
  processing_status: EmailProcessingStatus;
  error_log: string | null;
  created_at: string;
  updated_at: string;
}

export interface InboundAttachment {
  id: string;
  message_id: string;
  owner_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  content_hash: string | null;
  is_inline: boolean;
  created_at: string;
}

export interface MessageLink {
  id: string;
  message_id: string;
  owner_id: string;
  entity_type: EmailEntityType;
  entity_id: string;
  link_status: EmailLinkStatus;
  link_confidence: number;
  link_reasons: string[];
  created_by: "USER" | "SYSTEM";
  dismissed_at: string | null;
  created_at: string;
}

// Extended types for UI
export interface InboundMessageWithLinks extends InboundMessage {
  message_links: MessageLink[];
  inbound_attachments: InboundAttachment[];
}

export interface LinkedEntityInfo {
  entity_type: EmailEntityType;
  entity_id: string;
  entity_name: string;
  entity_details?: string;
}

export interface LinkableEntity {
  id: string;
  type: EmailEntityType;
  name: string;
  details?: string;
}
