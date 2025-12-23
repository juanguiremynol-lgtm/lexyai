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
      clients: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          email: string | null
          id: string
          id_number: string | null
          name: string
          notes: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          id_number?: string | null
          name: string
          notes?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          id_number?: string | null
          name?: string
          notes?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crawler_run_steps: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          meta: Json | null
          ok: boolean
          run_id: string
          step_name: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          meta?: Json | null
          ok?: boolean
          run_id: string
          step_name: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          meta?: Json | null
          ok?: boolean
          run_id?: string
          step_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawler_run_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crawler_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      crawler_runs: {
        Row: {
          adapter: string
          created_at: string
          debug_excerpt: string | null
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          http_status: number | null
          id: string
          owner_id: string
          radicado: string
          request_meta: Json | null
          response_meta: Json | null
          started_at: string
          status: string
        }
        Insert: {
          adapter: string
          created_at?: string
          debug_excerpt?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          owner_id: string
          radicado: string
          request_meta?: Json | null
          response_meta?: Json | null
          started_at?: string
          status?: string
        }
        Update: {
          adapter?: string
          created_at?: string
          debug_excerpt?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          owner_id?: string
          radicado?: string
          request_meta?: Json | null
          response_meta?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawler_runs_owner_id_fkey"
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
      estados_import_runs: {
        Row: {
          created_at: string
          error_message: string | null
          file_hash: string | null
          file_name: string
          id: string
          owner_id: string
          rows_matched: number | null
          rows_total: number | null
          rows_unmatched: number | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_hash?: string | null
          file_name: string
          id?: string
          owner_id: string
          rows_matched?: number | null
          rows_total?: number | null
          rows_unmatched?: number | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_hash?: string | null
          file_name?: string
          id?: string
          owner_id?: string
          rows_matched?: number | null
          rows_total?: number | null
          rows_unmatched?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "estados_import_runs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_snapshots: {
        Row: {
          created_at: string
          id: string
          monitored_process_id: string | null
          owner_id: string
          process_event_id: string | null
          raw_html: string | null
          raw_markdown: string | null
          screenshot_path: string | null
          source_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          monitored_process_id?: string | null
          owner_id: string
          process_event_id?: string | null
          raw_html?: string | null
          raw_markdown?: string | null
          screenshot_path?: string | null
          source_url: string
        }
        Update: {
          created_at?: string
          id?: string
          monitored_process_id?: string | null
          owner_id?: string
          process_event_id?: string | null
          raw_html?: string | null
          raw_markdown?: string | null
          screenshot_path?: string | null
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_snapshots_monitored_process_id_fkey"
            columns: ["monitored_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_snapshots_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_snapshots_process_event_id_fkey"
            columns: ["process_event_id"]
            isOneToOne: false
            referencedRelation: "process_events"
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
          crawler_enabled: boolean | null
          created_at: string
          filing_type: string
          id: string
          last_crawled_at: string | null
          last_event_at: string | null
          last_reviewed_at: string | null
          matter_id: string
          owner_id: string
          radicado: string | null
          rama_judicial_url: string | null
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
          crawler_enabled?: boolean | null
          created_at?: string
          filing_type: string
          id?: string
          last_crawled_at?: string | null
          last_event_at?: string | null
          last_reviewed_at?: string | null
          matter_id: string
          owner_id: string
          radicado?: string | null
          rama_judicial_url?: string | null
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
          crawler_enabled?: boolean | null
          created_at?: string
          filing_type?: string
          id?: string
          last_crawled_at?: string | null
          last_event_at?: string | null
          last_reviewed_at?: string | null
          matter_id?: string
          owner_id?: string
          radicado?: string | null
          rama_judicial_url?: string | null
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
      hearings: {
        Row: {
          auto_detected: boolean | null
          created_at: string
          filing_id: string
          id: string
          is_virtual: boolean | null
          location: string | null
          notes: string | null
          owner_id: string
          reminder_sent: boolean | null
          scheduled_at: string
          title: string
          updated_at: string
          virtual_link: string | null
        }
        Insert: {
          auto_detected?: boolean | null
          created_at?: string
          filing_id: string
          id?: string
          is_virtual?: boolean | null
          location?: string | null
          notes?: string | null
          owner_id: string
          reminder_sent?: boolean | null
          scheduled_at: string
          title: string
          updated_at?: string
          virtual_link?: string | null
        }
        Update: {
          auto_detected?: boolean | null
          created_at?: string
          filing_id?: string
          id?: string
          is_virtual?: boolean | null
          location?: string | null
          notes?: string | null
          owner_id?: string
          reminder_sent?: boolean | null
          scheduled_at?: string
          title?: string
          updated_at?: string
          virtual_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hearings_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hearings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      icarus_import_rows: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          radicado_norm: string | null
          radicado_raw: string | null
          reason: string | null
          row_index: number
          run_id: string
          source_payload: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          radicado_norm?: string | null
          radicado_raw?: string | null
          reason?: string | null
          row_index: number
          run_id: string
          source_payload?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          radicado_norm?: string | null
          radicado_raw?: string | null
          reason?: string | null
          row_index?: number
          run_id?: string
          source_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "icarus_import_rows_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "icarus_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      icarus_import_runs: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          file_hash: string | null
          file_name: string
          id: string
          owner_id: string
          rows_imported: number | null
          rows_skipped: number | null
          rows_total: number | null
          rows_updated: number | null
          rows_valid: number | null
          status: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_hash?: string | null
          file_name: string
          id?: string
          owner_id: string
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          rows_updated?: number | null
          rows_valid?: number | null
          status?: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_hash?: string | null
          file_name?: string
          id?: string
          owner_id?: string
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          rows_updated?: number | null
          rows_valid?: number | null
          status?: string
        }
        Relationships: []
      }
      icarus_sync_runs: {
        Row: {
          attempts: Json | null
          classification: string | null
          created_at: string
          error_message: string | null
          events_created: number | null
          finished_at: string | null
          id: string
          mode: string | null
          owner_id: string
          processes_found: number | null
          started_at: string
          status: string
          steps: Json | null
        }
        Insert: {
          attempts?: Json | null
          classification?: string | null
          created_at?: string
          error_message?: string | null
          events_created?: number | null
          finished_at?: string | null
          id?: string
          mode?: string | null
          owner_id: string
          processes_found?: number | null
          started_at?: string
          status?: string
          steps?: Json | null
        }
        Update: {
          attempts?: Json | null
          classification?: string | null
          created_at?: string
          error_message?: string | null
          events_created?: number | null
          finished_at?: string | null
          id?: string
          mode?: string | null
          owner_id?: string
          processes_found?: number | null
          started_at?: string
          status?: string
          steps?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "icarus_sync_runs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          metadata: Json | null
          owner_id: string
          password_encrypted: string | null
          provider: string
          secret_encrypted: string | null
          secret_last4: string | null
          session_encrypted: string | null
          session_last_ok_at: string | null
          status: string
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          metadata?: Json | null
          owner_id: string
          password_encrypted?: string | null
          provider: string
          secret_encrypted?: string | null
          secret_last4?: string | null
          session_encrypted?: string | null
          session_last_ok_at?: string | null
          status?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          metadata?: Json | null
          owner_id?: string
          password_encrypted?: string | null
          provider?: string
          secret_encrypted?: string | null
          secret_last4?: string | null
          session_encrypted?: string | null
          session_last_ok_at?: string | null
          status?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matters: {
        Row: {
          client_id: string | null
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
          client_id?: string | null
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
          client_id?: string | null
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
            foreignKeyName: "matters_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matters_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_processes: {
        Row: {
          client_id: string | null
          created_at: string
          demandados: string | null
          demandantes: string | null
          department: string | null
          despacho_name: string | null
          expediente_digital_url: string | null
          id: string
          juez_ponente: string | null
          jurisdiction: string | null
          last_action_date: string | null
          last_action_date_raw: string | null
          last_change_at: string | null
          last_checked_at: string | null
          last_reviewed_at: string | null
          monitoring_enabled: boolean | null
          monitoring_schedule: string | null
          municipality: string | null
          notes: string | null
          owner_id: string
          radicado: string
          source: string | null
          source_payload: Json | null
          source_run_id: string | null
          sources_enabled: Json | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          department?: string | null
          despacho_name?: string | null
          expediente_digital_url?: string | null
          id?: string
          juez_ponente?: string | null
          jurisdiction?: string | null
          last_action_date?: string | null
          last_action_date_raw?: string | null
          last_change_at?: string | null
          last_checked_at?: string | null
          last_reviewed_at?: string | null
          monitoring_enabled?: boolean | null
          monitoring_schedule?: string | null
          municipality?: string | null
          notes?: string | null
          owner_id: string
          radicado: string
          source?: string | null
          source_payload?: Json | null
          source_run_id?: string | null
          sources_enabled?: Json | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          department?: string | null
          despacho_name?: string | null
          expediente_digital_url?: string | null
          id?: string
          juez_ponente?: string | null
          jurisdiction?: string | null
          last_action_date?: string | null
          last_action_date_raw?: string | null
          last_change_at?: string | null
          last_checked_at?: string | null
          last_reviewed_at?: string | null
          monitoring_enabled?: boolean | null
          monitoring_schedule?: string | null
          municipality?: string | null
          notes?: string | null
          owner_id?: string
          radicado?: string
          source?: string | null
          source_payload?: Json | null
          source_run_id?: string | null
          sources_enabled?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitored_processes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitored_processes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      process_estados: {
        Row: {
          created_at: string
          demandados: string | null
          demandantes: string | null
          despacho: string | null
          distrito: string | null
          fecha_ultima_actuacion: string | null
          fecha_ultima_actuacion_raw: string | null
          id: string
          import_run_id: string | null
          juez_ponente: string | null
          monitored_process_id: string | null
          owner_id: string
          radicado: string
          source_payload: Json | null
        }
        Insert: {
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          despacho?: string | null
          distrito?: string | null
          fecha_ultima_actuacion?: string | null
          fecha_ultima_actuacion_raw?: string | null
          id?: string
          import_run_id?: string | null
          juez_ponente?: string | null
          monitored_process_id?: string | null
          owner_id: string
          radicado: string
          source_payload?: Json | null
        }
        Update: {
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          despacho?: string | null
          distrito?: string | null
          fecha_ultima_actuacion?: string | null
          fecha_ultima_actuacion_raw?: string | null
          id?: string
          import_run_id?: string | null
          juez_ponente?: string | null
          monitored_process_id?: string | null
          owner_id?: string
          radicado?: string
          source_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "process_estados_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "estados_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_estados_monitored_process_id_fkey"
            columns: ["monitored_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_estados_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      process_events: {
        Row: {
          attachments: Json | null
          created_at: string
          description: string
          detail: string | null
          event_date: string | null
          event_type: string
          filing_id: string
          hash_fingerprint: string | null
          id: string
          monitored_process_id: string | null
          owner_id: string
          raw_data: Json | null
          source: string | null
          source_url: string | null
          title: string | null
        }
        Insert: {
          attachments?: Json | null
          created_at?: string
          description: string
          detail?: string | null
          event_date?: string | null
          event_type: string
          filing_id: string
          hash_fingerprint?: string | null
          id?: string
          monitored_process_id?: string | null
          owner_id: string
          raw_data?: Json | null
          source?: string | null
          source_url?: string | null
          title?: string | null
        }
        Update: {
          attachments?: Json | null
          created_at?: string
          description?: string
          detail?: string | null
          event_date?: string | null
          event_type?: string
          filing_id?: string
          hash_fingerprint?: string | null
          id?: string
          monitored_process_id?: string | null
          owner_id?: string
          raw_data?: Json | null
          source?: string | null
          source_url?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_events_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_events_monitored_process_id_fkey"
            columns: ["monitored_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_events_owner_id_fkey"
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
          estados_import_interval_days: number | null
          firm_name: string | null
          full_name: string | null
          id: string
          last_estados_import_at: string | null
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
          estados_import_interval_days?: number | null
          firm_name?: string | null
          full_name?: string | null
          id: string
          last_estados_import_at?: string | null
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
          estados_import_interval_days?: number | null
          firm_name?: string | null
          full_name?: string | null
          id?: string
          last_estados_import_at?: string | null
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
      review_logs: {
        Row: {
          entity_id: string
          entity_type: string
          id: string
          notes: string | null
          owner_id: string
          reviewed_at: string
        }
        Insert: {
          entity_id: string
          entity_type: string
          id?: string
          notes?: string | null
          owner_id: string
          reviewed_at?: string
        }
        Update: {
          entity_id?: string
          entity_type?: string
          id?: string
          notes?: string | null
          owner_id?: string
          reviewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_logs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      data_source: "CPNU" | "PUBLICACIONES" | "HISTORICO"
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
      process_event_type:
        | "ACTUACION"
        | "ESTADO_ELECTRONICO"
        | "NOTIFICACION"
        | "AUTO"
        | "SENTENCIA"
        | "PROVIDENCIA"
        | "MEMORIAL"
        | "TRASLADO"
        | "AUDIENCIA"
        | "OTRO"
      task_status: "OPEN" | "DONE" | "SNOOZED"
      task_type:
        | "FOLLOW_UP_REPARTO"
        | "FOLLOW_UP_COURT"
        | "ENTER_RADICADO"
        | "ADD_TO_ICARUS"
        | "REVIEW_ACTA_PARSE"
        | "GENERIC"
        | "REVIEW_PROCESS"
        | "REVIEW_FILING"
        | "IMPORT_ESTADOS"
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
      data_source: ["CPNU", "PUBLICACIONES", "HISTORICO"],
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
      process_event_type: [
        "ACTUACION",
        "ESTADO_ELECTRONICO",
        "NOTIFICACION",
        "AUTO",
        "SENTENCIA",
        "PROVIDENCIA",
        "MEMORIAL",
        "TRASLADO",
        "AUDIENCIA",
        "OTRO",
      ],
      task_status: ["OPEN", "DONE", "SNOOZED"],
      task_type: [
        "FOLLOW_UP_REPARTO",
        "FOLLOW_UP_COURT",
        "ENTER_RADICADO",
        "ADD_TO_ICARUS",
        "REVIEW_ACTA_PARSE",
        "GENERIC",
        "REVIEW_PROCESS",
        "REVIEW_FILING",
        "IMPORT_ESTADOS",
      ],
    },
  },
} as const
