export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          created_at: string
          filing_id: string | null
          id: string
          is_read: boolean | null
          message: string
          owner_id: string
          severity: Database["public"]["Enums"]["alert_severity"]
        }
        Insert: {
          created_at?: string
          filing_id?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          owner_id: string
          severity?: Database["public"]["Enums"]["alert_severity"]
        }
        Update: {
          created_at?: string
          filing_id?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          owner_id?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          extracted_json: Json | null
          file_path: string
          filing_id: string
          id: string
          kind: Database["public"]["Enums"]["document_kind"]
          original_filename: string
          owner_id: string
          sha256: string | null
          uploaded_at: string
        }
        Insert: {
          extracted_json?: Json | null
          file_path: string
          filing_id: string
          id?: string
          kind: Database["public"]["Enums"]["document_kind"]
          original_filename: string
          owner_id: string
          sha256?: string | null
          uploaded_at?: string
        }
        Update: {
          extracted_json?: Json | null
          file_path?: string
          filing_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["document_kind"]
          original_filename?: string
          owner_id?: string
          sha256?: string | null
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          created_at: string
          filing_id: string
          id: string
          owner_id: string
          subject: string
        }
        Insert: {
          created_at?: string
          filing_id: string
          id?: string
          owner_id: string
          subject: string
        }
        Update: {
          created_at?: string
          filing_id?: string
          id?: string
          owner_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          body_html: string | null
          body_text: string | null
          cc: string | null
          created_at: string
          direction: Database["public"]["Enums"]["email_direction"]
          filing_id: string
          id: string
          owner_id: string
          received_at: string | null
          recipient: string | null
          sender: string | null
          sent_at: string | null
          status: string | null
          subject: string
          thread_id: string | null
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          cc?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["email_direction"]
          filing_id: string
          id?: string
          owner_id: string
          received_at?: string | null
          recipient?: string | null
          sender?: string | null
          sent_at?: string | null
          status?: string | null
          subject: string
          thread_id?: string | null
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          cc?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["email_direction"]
          filing_id?: string
          id?: string
          owner_id?: string
          received_at?: string | null
          recipient?: string | null
          sender?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emails_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      filings: {
        Row: {
          acta_received_at: string | null
          court_city: string | null
          court_department: string | null
          court_email: string | null
          court_name: string | null
          created_at: string
          filing_type: string
          id: string
          last_event_at: string | null
          matter_id: string
          owner_id: string
          radicado: string | null
          reparto_email_to: string | null
          reparto_reference: string | null
          sent_at: string | null
          sla_acta_due_at: string | null
          sla_court_reply_due_at: string | null
          sla_receipt_due_at: string | null
          status: Database["public"]["Enums"]["filing_status"]
          updated_at: string
        }
        Insert: {
          acta_received_at?: string | null
          court_city?: string | null
          court_department?: string | null
          court_email?: string | null
          court_name?: string | null
          created_at?: string
          filing_type: string
          id?: string
          last_event_at?: string | null
          matter_id: string
          owner_id: string
          radicado?: string | null
          reparto_email_to?: string | null
          reparto_reference?: string | null
          sent_at?: string | null
          sla_acta_due_at?: string | null
          sla_court_reply_due_at?: string | null
          sla_receipt_due_at?: string | null
          status?: Database["public"]["Enums"]["filing_status"]
          updated_at?: string
        }
        Update: {
          acta_received_at?: string | null
          court_city?: string | null
          court_department?: string | null
          court_email?: string | null
          court_name?: string | null
          created_at?: string
          filing_type?: string
          id?: string
          last_event_at?: string | null
          matter_id?: string
          owner_id?: string
          radicado?: string | null
          reparto_email_to?: string | null
          reparto_reference?: string | null
          sent_at?: string | null
          sla_acta_due_at?: string | null
          sla_court_reply_due_at?: string | null
          sla_receipt_due_at?: string | null
          status?: Database["public"]["Enums"]["filing_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "filings_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matters: {
        Row: {
          client_id_number: string | null
          client_name: string
          created_at: string
          id: string
          matter_name: string
          notes: string | null
          owner_id: string
          practice_area: string | null
          updated_at: string
        }
        Insert: {
          client_id_number?: string | null
          client_name: string
          created_at?: string
          id?: string
          matter_name: string
          notes?: string | null
          owner_id: string
          practice_area?: string | null
          updated_at?: string
        }
        Update: {
          client_id_number?: string | null
          client_name?: string
          created_at?: string
          id?: string
          matter_name?: string
          notes?: string | null
          owner_id?: string
          practice_area?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matters_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          firm_name: string | null
          full_name: string | null
          id: string
          reparto_directory: Json | null
          signature_block: string | null
          sla_acta_days: number | null
          sla_court_reply_days: number | null
          sla_receipt_hours: number | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          firm_name?: string | null
          full_name?: string | null
          id: string
          reparto_directory?: Json | null
          signature_block?: string | null
          sla_acta_days?: number | null
          sla_court_reply_days?: number | null
          sla_receipt_hours?: number | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          firm_name?: string | null
          full_name?: string | null
          id?: string
          reparto_directory?: Json | null
          signature_block?: string | null
          sla_acta_days?: number | null
          sla_court_reply_days?: number | null
          sla_receipt_hours?: number | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          auto_generated: boolean | null
          created_at: string
          due_at: string
          filing_id: string | null
          id: string
          metadata: Json | null
          owner_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean | null
          created_at?: string
          due_at: string
          filing_id?: string | null
          id?: string
          metadata?: Json | null
          owner_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean | null
          created_at?: string
          due_at?: string
          filing_id?: string | null
          id?: string
          metadata?: Json | null
          owner_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      alert_severity: "INFO" | "WARN" | "CRITICAL"
      document_kind:
        | "DEMANDA"
        | "ACTA_REPARTO"
        | "AUTO_RECEIPT"
        | "COURT_RESPONSE"
        | "OTHER"
      email_direction: "OUT" | "IN" | "DRAFT"
      filing_status:
        | "DRAFTED"
        | "SENT_TO_REPARTO"
        | "RECEIPT_CONFIRMED"
        | "ACTA_PENDING"
        | "ACTA_RECEIVED_PARSED"
        | "COURT_EMAIL_DRAFTED"
        | "COURT_EMAIL_SENT"
        | "RADICADO_PENDING"
        | "RADICADO_CONFIRMED"
        | "ICARUS_SYNC_PENDING"
        | "MONITORING_ACTIVE"
        | "CLOSED"
      task_status: "OPEN" | "DONE" | "SNOOZED"
      task_type:
        | "FOLLOW_UP_REPARTO"
        | "FOLLOW_UP_COURT"
        | "ENTER_RADICADO"
        | "ADD_TO_ICARUS"
        | "REVIEW_ACTA_PARSE"
        | "GENERIC"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["INFO", "WARN", "CRITICAL"],
      document_kind: [
        "DEMANDA",
        "ACTA_REPARTO",
        "AUTO_RECEIPT",
        "COURT_RESPONSE",
        "OTHER",
      ],
      email_direction: ["OUT", "IN", "DRAFT"],
      filing_status: [
        "DRAFTED",
        "SENT_TO_REPARTO",
        "RECEIPT_CONFIRMED",
        "ACTA_PENDING",
        "ACTA_RECEIVED_PARSED",
        "COURT_EMAIL_DRAFTED",
        "COURT_EMAIL_SENT",
        "RADICADO_PENDING",
        "RADICADO_CONFIRMED",
        "ICARUS_SYNC_PENDING",
        "MONITORING_ACTIVE",
        "CLOSED",
      ],
      task_status: ["OPEN", "DONE", "SNOOZED"],
      task_type: [
        "FOLLOW_UP_REPARTO",
        "FOLLOW_UP_COURT",
        "ENTER_RADICADO",
        "ADD_TO_ICARUS",
        "REVIEW_ACTA_PARSE",
        "GENERIC",
      ],
    },
  },
} as const
