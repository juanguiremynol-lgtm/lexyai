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
      actuaciones: {
        Row: {
          act_date: string | null
          act_date_raw: string | null
          act_time: string | null
          act_type_guess: string | null
          adapter_name: string | null
          attachments: Json | null
          confidence: number | null
          created_at: string
          filing_id: string | null
          hash_fingerprint: string
          id: string
          monitored_process_id: string | null
          normalized_text: string
          owner_id: string
          raw_data: Json | null
          raw_text: string
          source: string
          source_url: string | null
        }
        Insert: {
          act_date?: string | null
          act_date_raw?: string | null
          act_time?: string | null
          act_type_guess?: string | null
          adapter_name?: string | null
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          filing_id?: string | null
          hash_fingerprint: string
          id?: string
          monitored_process_id?: string | null
          normalized_text: string
          owner_id: string
          raw_data?: Json | null
          raw_text: string
          source?: string
          source_url?: string | null
        }
        Update: {
          act_date?: string | null
          act_date_raw?: string | null
          act_time?: string | null
          act_type_guess?: string | null
          adapter_name?: string | null
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          filing_id?: string | null
          hash_fingerprint?: string
          id?: string
          monitored_process_id?: string | null
          normalized_text?: string
          owner_id?: string
          raw_data?: Json | null
          raw_text?: string
          source?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actuaciones_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actuaciones_monitored_process_id_fkey"
            columns: ["monitored_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actuaciones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_instances: {
        Row: {
          acknowledged_at: string | null
          actions: Json | null
          alert_rule_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          fired_at: string
          id: string
          message: string
          next_fire_at: string | null
          owner_id: string
          payload: Json | null
          resolved_at: string | null
          sent_at: string | null
          severity: string
          status: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          actions?: Json | null
          alert_rule_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          fired_at?: string
          id?: string
          message: string
          next_fire_at?: string | null
          owner_id: string
          payload?: Json | null
          resolved_at?: string | null
          sent_at?: string | null
          severity?: string
          status?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          actions?: Json | null
          alert_rule_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          fired_at?: string
          id?: string
          message?: string
          next_fire_at?: string | null
          owner_id?: string
          payload?: Json | null
          resolved_at?: string | null
          sent_at?: string | null
          severity?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_instances_alert_rule_id_fkey"
            columns: ["alert_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_instances_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          active: boolean | null
          channels: string[]
          created_at: string
          description: string | null
          due_at: string | null
          email_recipients: string[] | null
          entity_id: string
          entity_type: string
          first_fire_at: string | null
          id: string
          is_optional_user_defined: boolean | null
          is_system_mandatory: boolean | null
          next_fire_at: string | null
          owner_id: string
          repeat_every_business_days: number | null
          repeat_every_days: number | null
          rule_kind: string
          stop_condition: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          channels?: string[]
          created_at?: string
          description?: string | null
          due_at?: string | null
          email_recipients?: string[] | null
          entity_id: string
          entity_type: string
          first_fire_at?: string | null
          id?: string
          is_optional_user_defined?: boolean | null
          is_system_mandatory?: boolean | null
          next_fire_at?: string | null
          owner_id: string
          repeat_every_business_days?: number | null
          repeat_every_days?: number | null
          rule_kind: string
          stop_condition?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          channels?: string[]
          created_at?: string
          description?: string | null
          due_at?: string | null
          email_recipients?: string[] | null
          entity_id?: string
          entity_type?: string
          first_fire_at?: string | null
          id?: string
          is_optional_user_defined?: boolean | null
          is_system_mandatory?: boolean | null
          next_fire_at?: string | null
          owner_id?: string
          repeat_every_business_days?: number | null
          repeat_every_days?: number | null
          rule_kind?: string
          stop_condition?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      cgp_deadline_rules: {
        Row: {
          cgp_variant: string
          created_at: string | null
          deadline_days: number
          deadline_type: string
          description: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          owner_id: string | null
          trigger_event: string
        }
        Insert: {
          cgp_variant: string
          created_at?: string | null
          deadline_days: number
          deadline_type: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          owner_id?: string | null
          trigger_event: string
        }
        Update: {
          cgp_variant?: string
          created_at?: string | null
          deadline_days?: number
          deadline_type?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          owner_id?: string | null
          trigger_event?: string
        }
        Relationships: []
      }
      cgp_deadlines: {
        Row: {
          created_at: string | null
          deadline_date: string
          description: string | null
          id: string
          owner_id: string
          status: string
          trigger_date: string
          trigger_event: string
          work_item_id: string
        }
        Insert: {
          created_at?: string | null
          deadline_date: string
          description?: string | null
          id?: string
          owner_id: string
          status?: string
          trigger_date: string
          trigger_event: string
          work_item_id: string
        }
        Update: {
          created_at?: string | null
          deadline_date?: string
          description?: string | null
          id?: string
          owner_id?: string
          status?: string
          trigger_date?: string
          trigger_event?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cgp_deadlines_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cgp_inactivity_tracker: {
        Row: {
          created_at: string
          filing_id: string | null
          has_favorable_sentencia: boolean
          id: string
          inactivity_threshold_months: number
          is_at_risk: boolean
          last_activity_date: string
          last_activity_description: string | null
          last_activity_milestone_id: string | null
          owner_id: string
          process_id: string | null
          risk_since: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          filing_id?: string | null
          has_favorable_sentencia?: boolean
          id?: string
          inactivity_threshold_months?: number
          is_at_risk?: boolean
          last_activity_date: string
          last_activity_description?: string | null
          last_activity_milestone_id?: string | null
          owner_id: string
          process_id?: string | null
          risk_since?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          filing_id?: string | null
          has_favorable_sentencia?: boolean
          id?: string
          inactivity_threshold_months?: number
          is_at_risk?: boolean
          last_activity_date?: string
          last_activity_description?: string | null
          last_activity_milestone_id?: string | null
          owner_id?: string
          process_id?: string | null
          risk_since?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cgp_inactivity_tracker_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_inactivity_tracker_last_activity_milestone_id_fkey"
            columns: ["last_activity_milestone_id"]
            isOneToOne: false
            referencedRelation: "cgp_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_inactivity_tracker_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_inactivity_tracker_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      cgp_items: {
        Row: {
          acta_received_at: string | null
          auto_admisorio_date: string | null
          case_family: string | null
          case_subtype: string | null
          client_id: string | null
          court_city: string | null
          court_department: string | null
          court_email: string | null
          court_name: string | null
          cpnu_confirmed: boolean | null
          cpnu_confirmed_at: string | null
          created_at: string
          demandados: string | null
          demandantes: string | null
          description: string | null
          email_linking_enabled: boolean | null
          expediente_url: string | null
          filing_method: string | null
          filing_status: string | null
          filing_type: string | null
          has_auto_admisorio: boolean
          id: string
          is_flagged: boolean | null
          juez_ponente: string | null
          last_action_date: string | null
          last_action_date_raw: string | null
          last_change_at: string | null
          last_checked_at: string | null
          last_crawled_at: string | null
          last_reviewed_at: string | null
          legacy_filing_id: string | null
          legacy_process_id: string | null
          matter_id: string | null
          monitoring_enabled: boolean | null
          monitoring_schedule: string | null
          notes: string | null
          owner_id: string
          phase: Database["public"]["Enums"]["cgp_phase"]
          phase_source: Database["public"]["Enums"]["cgp_phase_source"]
          practice_area: string | null
          process_phase: string | null
          radicado: string | null
          radicado_status: string | null
          reparto_email_to: string | null
          reparto_reference: string | null
          scrape_status: string | null
          scraped_fields: Json | null
          sent_at: string | null
          sla_acta_due_at: string | null
          sla_court_reply_due_at: string | null
          sla_receipt_due_at: string | null
          source_links: Json | null
          sources_enabled: Json | null
          status: Database["public"]["Enums"]["cgp_status"]
          target_authority: string | null
          total_actuaciones: number | null
          total_sujetos_procesales: number | null
          updated_at: string
        }
        Insert: {
          acta_received_at?: string | null
          auto_admisorio_date?: string | null
          case_family?: string | null
          case_subtype?: string | null
          client_id?: string | null
          court_city?: string | null
          court_department?: string | null
          court_email?: string | null
          court_name?: string | null
          cpnu_confirmed?: boolean | null
          cpnu_confirmed_at?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          expediente_url?: string | null
          filing_method?: string | null
          filing_status?: string | null
          filing_type?: string | null
          has_auto_admisorio?: boolean
          id?: string
          is_flagged?: boolean | null
          juez_ponente?: string | null
          last_action_date?: string | null
          last_action_date_raw?: string | null
          last_change_at?: string | null
          last_checked_at?: string | null
          last_crawled_at?: string | null
          last_reviewed_at?: string | null
          legacy_filing_id?: string | null
          legacy_process_id?: string | null
          matter_id?: string | null
          monitoring_enabled?: boolean | null
          monitoring_schedule?: string | null
          notes?: string | null
          owner_id: string
          phase?: Database["public"]["Enums"]["cgp_phase"]
          phase_source?: Database["public"]["Enums"]["cgp_phase_source"]
          practice_area?: string | null
          process_phase?: string | null
          radicado?: string | null
          radicado_status?: string | null
          reparto_email_to?: string | null
          reparto_reference?: string | null
          scrape_status?: string | null
          scraped_fields?: Json | null
          sent_at?: string | null
          sla_acta_due_at?: string | null
          sla_court_reply_due_at?: string | null
          sla_receipt_due_at?: string | null
          source_links?: Json | null
          sources_enabled?: Json | null
          status?: Database["public"]["Enums"]["cgp_status"]
          target_authority?: string | null
          total_actuaciones?: number | null
          total_sujetos_procesales?: number | null
          updated_at?: string
        }
        Update: {
          acta_received_at?: string | null
          auto_admisorio_date?: string | null
          case_family?: string | null
          case_subtype?: string | null
          client_id?: string | null
          court_city?: string | null
          court_department?: string | null
          court_email?: string | null
          court_name?: string | null
          cpnu_confirmed?: boolean | null
          cpnu_confirmed_at?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          expediente_url?: string | null
          filing_method?: string | null
          filing_status?: string | null
          filing_type?: string | null
          has_auto_admisorio?: boolean
          id?: string
          is_flagged?: boolean | null
          juez_ponente?: string | null
          last_action_date?: string | null
          last_action_date_raw?: string | null
          last_change_at?: string | null
          last_checked_at?: string | null
          last_crawled_at?: string | null
          last_reviewed_at?: string | null
          legacy_filing_id?: string | null
          legacy_process_id?: string | null
          matter_id?: string | null
          monitoring_enabled?: boolean | null
          monitoring_schedule?: string | null
          notes?: string | null
          owner_id?: string
          phase?: Database["public"]["Enums"]["cgp_phase"]
          phase_source?: Database["public"]["Enums"]["cgp_phase_source"]
          practice_area?: string | null
          process_phase?: string | null
          radicado?: string | null
          radicado_status?: string | null
          reparto_email_to?: string | null
          reparto_reference?: string | null
          scrape_status?: string | null
          scraped_fields?: Json | null
          sent_at?: string | null
          sla_acta_due_at?: string | null
          sla_court_reply_due_at?: string | null
          sla_receipt_due_at?: string | null
          source_links?: Json | null
          sources_enabled?: Json | null
          status?: Database["public"]["Enums"]["cgp_status"]
          target_authority?: string | null
          total_actuaciones?: number | null
          total_sujetos_procesales?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cgp_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_items_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
        ]
      }
      cgp_milestones: {
        Row: {
          attachments: Json | null
          confidence: number | null
          created_at: string
          created_by: string | null
          custom_type_name: string | null
          event_date: string | null
          event_time: string | null
          filing_id: string | null
          id: string
          in_audience: boolean
          milestone_type: Database["public"]["Enums"]["cgp_milestone_type"]
          needs_user_confirmation: boolean | null
          notes: string | null
          notificacion_subtype:
            | Database["public"]["Enums"]["notificacion_subtype"]
            | null
          occurred: boolean
          owner_id: string
          pattern_match_explanation: Json | null
          process_id: string | null
          source: Database["public"]["Enums"]["milestone_source"] | null
          source_actuacion_id: string | null
          updated_at: string
          user_confirmed_at: string | null
          user_rejected_at: string | null
        }
        Insert: {
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          custom_type_name?: string | null
          event_date?: string | null
          event_time?: string | null
          filing_id?: string | null
          id?: string
          in_audience?: boolean
          milestone_type: Database["public"]["Enums"]["cgp_milestone_type"]
          needs_user_confirmation?: boolean | null
          notes?: string | null
          notificacion_subtype?:
            | Database["public"]["Enums"]["notificacion_subtype"]
            | null
          occurred?: boolean
          owner_id: string
          pattern_match_explanation?: Json | null
          process_id?: string | null
          source?: Database["public"]["Enums"]["milestone_source"] | null
          source_actuacion_id?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_rejected_at?: string | null
        }
        Update: {
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          custom_type_name?: string | null
          event_date?: string | null
          event_time?: string | null
          filing_id?: string | null
          id?: string
          in_audience?: boolean
          milestone_type?: Database["public"]["Enums"]["cgp_milestone_type"]
          needs_user_confirmation?: boolean | null
          notes?: string | null
          notificacion_subtype?:
            | Database["public"]["Enums"]["notificacion_subtype"]
            | null
          occurred?: boolean
          owner_id?: string
          pattern_match_explanation?: Json | null
          process_id?: string | null
          source?: Database["public"]["Enums"]["milestone_source"] | null
          source_actuacion_id?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_rejected_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cgp_milestones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_milestones_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_milestones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_milestones_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_milestones_source_actuacion_id_fkey"
            columns: ["source_actuacion_id"]
            isOneToOne: false
            referencedRelation: "actuaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      cgp_term_instances: {
        Row: {
          computed_with_suspensions: boolean
          created_at: string
          due_date: string
          filing_id: string | null
          id: string
          in_audience: boolean
          last_computed_at: string
          original_due_date: string
          owner_id: string
          pause_reason: string | null
          paused_at: string | null
          paused_days_accumulated: number | null
          process_id: string | null
          satisfaction_notes: string | null
          satisfied_at: string | null
          satisfied_by_milestone_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["cgp_term_status"]
          term_name: string
          term_template_code: string
          term_template_id: string | null
          trigger_date: string
          trigger_milestone_id: string | null
          updated_at: string
        }
        Insert: {
          computed_with_suspensions?: boolean
          created_at?: string
          due_date: string
          filing_id?: string | null
          id?: string
          in_audience?: boolean
          last_computed_at?: string
          original_due_date: string
          owner_id: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_days_accumulated?: number | null
          process_id?: string | null
          satisfaction_notes?: string | null
          satisfied_at?: string | null
          satisfied_by_milestone_id?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["cgp_term_status"]
          term_name: string
          term_template_code: string
          term_template_id?: string | null
          trigger_date: string
          trigger_milestone_id?: string | null
          updated_at?: string
        }
        Update: {
          computed_with_suspensions?: boolean
          created_at?: string
          due_date?: string
          filing_id?: string | null
          id?: string
          in_audience?: boolean
          last_computed_at?: string
          original_due_date?: string
          owner_id?: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_days_accumulated?: number | null
          process_id?: string | null
          satisfaction_notes?: string | null
          satisfied_at?: string | null
          satisfied_by_milestone_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["cgp_term_status"]
          term_name?: string
          term_template_code?: string
          term_template_id?: string | null
          trigger_date?: string
          trigger_milestone_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cgp_term_instances_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_term_instances_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_term_instances_process_id_fkey"
            columns: ["process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_term_instances_satisfied_by_milestone_id_fkey"
            columns: ["satisfied_by_milestone_id"]
            isOneToOne: false
            referencedRelation: "cgp_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_term_instances_term_template_id_fkey"
            columns: ["term_template_id"]
            isOneToOne: false
            referencedRelation: "cgp_term_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_term_instances_trigger_milestone_id_fkey"
            columns: ["trigger_milestone_id"]
            isOneToOne: false
            referencedRelation: "cgp_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      cgp_term_templates: {
        Row: {
          active: boolean
          alerts_days_before: Json | null
          code: string
          consequence_summary: string | null
          created_at: string
          description: string | null
          duration_unit: Database["public"]["Enums"]["cgp_duration_unit"]
          duration_value: number
          id: string
          is_system: boolean
          legal_basis: string | null
          name: string
          owner_id: string | null
          pause_on_expediente_al_despacho: boolean
          pause_on_judicial_suspension: boolean
          pause_on_resource_filed: boolean
          process_family: string
          process_type: Database["public"]["Enums"]["cgp_process_type"]
          satisfied_by_milestone_type:
            | Database["public"]["Enums"]["cgp_milestone_type"]
            | null
          start_rule: Database["public"]["Enums"]["cgp_start_rule"]
          trigger_milestone_type: Database["public"]["Enums"]["cgp_milestone_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          alerts_days_before?: Json | null
          code: string
          consequence_summary?: string | null
          created_at?: string
          description?: string | null
          duration_unit?: Database["public"]["Enums"]["cgp_duration_unit"]
          duration_value: number
          id?: string
          is_system?: boolean
          legal_basis?: string | null
          name: string
          owner_id?: string | null
          pause_on_expediente_al_despacho?: boolean
          pause_on_judicial_suspension?: boolean
          pause_on_resource_filed?: boolean
          process_family?: string
          process_type?: Database["public"]["Enums"]["cgp_process_type"]
          satisfied_by_milestone_type?:
            | Database["public"]["Enums"]["cgp_milestone_type"]
            | null
          start_rule?: Database["public"]["Enums"]["cgp_start_rule"]
          trigger_milestone_type: Database["public"]["Enums"]["cgp_milestone_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          alerts_days_before?: Json | null
          code?: string
          consequence_summary?: string | null
          created_at?: string
          description?: string | null
          duration_unit?: Database["public"]["Enums"]["cgp_duration_unit"]
          duration_value?: number
          id?: string
          is_system?: boolean
          legal_basis?: string | null
          name?: string
          owner_id?: string | null
          pause_on_expediente_al_despacho?: boolean
          pause_on_judicial_suspension?: boolean
          pause_on_resource_filed?: boolean
          process_family?: string
          process_type?: Database["public"]["Enums"]["cgp_process_type"]
          satisfied_by_milestone_type?:
            | Database["public"]["Enums"]["cgp_milestone_type"]
            | null
          start_rule?: Database["public"]["Enums"]["cgp_start_rule"]
          trigger_milestone_type?: Database["public"]["Enums"]["cgp_milestone_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cgp_term_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          client_id: string
          created_at: string
          document_content: string
          document_type: string
          file_path_docx: string | null
          file_path_pdf: string | null
          id: string
          owner_id: string
          variables_snapshot: Json
        }
        Insert: {
          client_id: string
          created_at?: string
          document_content: string
          document_type: string
          file_path_docx?: string | null
          file_path_pdf?: string | null
          id?: string
          owner_id: string
          variables_snapshot?: Json
        }
        Update: {
          client_id?: string
          created_at?: string
          document_content?: string
          document_type?: string
          file_path_docx?: string | null
          file_path_pdf?: string | null
          id?: string
          owner_id?: string
          variables_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_owner_id_fkey"
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
          email_linking_enabled: boolean | null
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
          email_linking_enabled?: boolean | null
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
          email_linking_enabled?: boolean | null
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
      colombian_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          is_judicial_vacation: boolean
          name: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          is_judicial_vacation?: boolean
          name: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          is_judicial_vacation?: boolean
          name?: string
        }
        Relationships: []
      }
      contract_payments: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          description: string
          due_date: string | null
          id: string
          owner_id: string
          paid_at: string | null
        }
        Insert: {
          amount?: number
          contract_id: string
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          owner_id: string
          paid_at?: string | null
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          owner_id?: string
          paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_payments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          client_id: string
          contract_date: string
          contract_value: number
          created_at: string
          id: string
          notes: string | null
          owner_id: string
          payment_modality: string
          service_description: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          contract_date?: string
          contract_value?: number
          created_at?: string
          id?: string
          notes?: string | null
          owner_id: string
          payment_modality?: string
          service_description: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          contract_date?: string
          contract_value?: number
          created_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          payment_modality?: string
          service_description?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cpaca_processes: {
        Row: {
          acto_administrativo_fecha: string | null
          acto_administrativo_notificacion_fecha: string | null
          agotamiento_via_gubernativa: boolean
          client_id: string | null
          conciliacion_requisito: boolean
          created_at: string
          demandados: string | null
          demandantes: string | null
          descripcion: string | null
          despacho_ciudad: string | null
          despacho_email: string | null
          despacho_nombre: string | null
          estado_caducidad:
            | Database["public"]["Enums"]["cpaca_estado_caducidad"]
            | null
          estado_conciliacion:
            | Database["public"]["Enums"]["cpaca_estado_conciliacion"]
            | null
          fecha_audiencia_inicial: string | null
          fecha_audiencia_juzgamiento: string | null
          fecha_audiencia_pruebas: string | null
          fecha_auto_admisorio: string | null
          fecha_auto_inadmision: string | null
          fecha_auto_rechazo: string | null
          fecha_constancia_acceso: string | null
          fecha_contestacion_demanda: string | null
          fecha_ejecutoria: string | null
          fecha_envio_notificacion_electronica: string | null
          fecha_evento_caducidad_base: string | null
          fecha_hecho_danoso: string | null
          fecha_inicio_ejecucion: string | null
          fecha_inicio_termino: string | null
          fecha_interposicion_recurso: string | null
          fecha_limite_conciliacion: string | null
          fecha_notificacion_auto: string | null
          fecha_notificacion_excepciones: string | null
          fecha_notificacion_sentencia: string | null
          fecha_presentacion_reforma: string | null
          fecha_radicacion_conciliacion: string | null
          fecha_radicacion_demanda: string | null
          fecha_resolucion_recurso: string | null
          fecha_respuesta_excepciones: string | null
          fecha_sentencia: string | null
          fecha_vencimiento_apelacion_auto: string | null
          fecha_vencimiento_apelacion_sentencia: string | null
          fecha_vencimiento_caducidad: string | null
          fecha_vencimiento_reforma: string | null
          fecha_vencimiento_traslado_demanda: string | null
          fecha_vencimiento_traslado_excepciones: string | null
          hora_audiencia_inicial: string | null
          hora_audiencia_juzgamiento: string | null
          hora_audiencia_pruebas: string | null
          id: string
          is_flagged: boolean | null
          juez_ponente: string | null
          link_audiencia_inicial: string | null
          link_audiencia_pruebas: string | null
          lugar_audiencia_inicial: string | null
          lugar_audiencia_pruebas: string | null
          medio_de_control: Database["public"]["Enums"]["cpaca_medio_control"]
          medio_de_control_custom: string | null
          monitored_process_id: string | null
          notas: string | null
          owner_id: string
          phase: Database["public"]["Enums"]["cpaca_phase"]
          prorroga_traslado_demanda: boolean
          radicado: string | null
          sentencia_favorable: boolean | null
          tipo_recurso: string | null
          titulo: string | null
          updated_at: string
        }
        Insert: {
          acto_administrativo_fecha?: string | null
          acto_administrativo_notificacion_fecha?: string | null
          agotamiento_via_gubernativa?: boolean
          client_id?: string | null
          conciliacion_requisito?: boolean
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          descripcion?: string | null
          despacho_ciudad?: string | null
          despacho_email?: string | null
          despacho_nombre?: string | null
          estado_caducidad?:
            | Database["public"]["Enums"]["cpaca_estado_caducidad"]
            | null
          estado_conciliacion?:
            | Database["public"]["Enums"]["cpaca_estado_conciliacion"]
            | null
          fecha_audiencia_inicial?: string | null
          fecha_audiencia_juzgamiento?: string | null
          fecha_audiencia_pruebas?: string | null
          fecha_auto_admisorio?: string | null
          fecha_auto_inadmision?: string | null
          fecha_auto_rechazo?: string | null
          fecha_constancia_acceso?: string | null
          fecha_contestacion_demanda?: string | null
          fecha_ejecutoria?: string | null
          fecha_envio_notificacion_electronica?: string | null
          fecha_evento_caducidad_base?: string | null
          fecha_hecho_danoso?: string | null
          fecha_inicio_ejecucion?: string | null
          fecha_inicio_termino?: string | null
          fecha_interposicion_recurso?: string | null
          fecha_limite_conciliacion?: string | null
          fecha_notificacion_auto?: string | null
          fecha_notificacion_excepciones?: string | null
          fecha_notificacion_sentencia?: string | null
          fecha_presentacion_reforma?: string | null
          fecha_radicacion_conciliacion?: string | null
          fecha_radicacion_demanda?: string | null
          fecha_resolucion_recurso?: string | null
          fecha_respuesta_excepciones?: string | null
          fecha_sentencia?: string | null
          fecha_vencimiento_apelacion_auto?: string | null
          fecha_vencimiento_apelacion_sentencia?: string | null
          fecha_vencimiento_caducidad?: string | null
          fecha_vencimiento_reforma?: string | null
          fecha_vencimiento_traslado_demanda?: string | null
          fecha_vencimiento_traslado_excepciones?: string | null
          hora_audiencia_inicial?: string | null
          hora_audiencia_juzgamiento?: string | null
          hora_audiencia_pruebas?: string | null
          id?: string
          is_flagged?: boolean | null
          juez_ponente?: string | null
          link_audiencia_inicial?: string | null
          link_audiencia_pruebas?: string | null
          lugar_audiencia_inicial?: string | null
          lugar_audiencia_pruebas?: string | null
          medio_de_control?: Database["public"]["Enums"]["cpaca_medio_control"]
          medio_de_control_custom?: string | null
          monitored_process_id?: string | null
          notas?: string | null
          owner_id: string
          phase?: Database["public"]["Enums"]["cpaca_phase"]
          prorroga_traslado_demanda?: boolean
          radicado?: string | null
          sentencia_favorable?: boolean | null
          tipo_recurso?: string | null
          titulo?: string | null
          updated_at?: string
        }
        Update: {
          acto_administrativo_fecha?: string | null
          acto_administrativo_notificacion_fecha?: string | null
          agotamiento_via_gubernativa?: boolean
          client_id?: string | null
          conciliacion_requisito?: boolean
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          descripcion?: string | null
          despacho_ciudad?: string | null
          despacho_email?: string | null
          despacho_nombre?: string | null
          estado_caducidad?:
            | Database["public"]["Enums"]["cpaca_estado_caducidad"]
            | null
          estado_conciliacion?:
            | Database["public"]["Enums"]["cpaca_estado_conciliacion"]
            | null
          fecha_audiencia_inicial?: string | null
          fecha_audiencia_juzgamiento?: string | null
          fecha_audiencia_pruebas?: string | null
          fecha_auto_admisorio?: string | null
          fecha_auto_inadmision?: string | null
          fecha_auto_rechazo?: string | null
          fecha_constancia_acceso?: string | null
          fecha_contestacion_demanda?: string | null
          fecha_ejecutoria?: string | null
          fecha_envio_notificacion_electronica?: string | null
          fecha_evento_caducidad_base?: string | null
          fecha_hecho_danoso?: string | null
          fecha_inicio_ejecucion?: string | null
          fecha_inicio_termino?: string | null
          fecha_interposicion_recurso?: string | null
          fecha_limite_conciliacion?: string | null
          fecha_notificacion_auto?: string | null
          fecha_notificacion_excepciones?: string | null
          fecha_notificacion_sentencia?: string | null
          fecha_presentacion_reforma?: string | null
          fecha_radicacion_conciliacion?: string | null
          fecha_radicacion_demanda?: string | null
          fecha_resolucion_recurso?: string | null
          fecha_respuesta_excepciones?: string | null
          fecha_sentencia?: string | null
          fecha_vencimiento_apelacion_auto?: string | null
          fecha_vencimiento_apelacion_sentencia?: string | null
          fecha_vencimiento_caducidad?: string | null
          fecha_vencimiento_reforma?: string | null
          fecha_vencimiento_traslado_demanda?: string | null
          fecha_vencimiento_traslado_excepciones?: string | null
          hora_audiencia_inicial?: string | null
          hora_audiencia_juzgamiento?: string | null
          hora_audiencia_pruebas?: string | null
          id?: string
          is_flagged?: boolean | null
          juez_ponente?: string | null
          link_audiencia_inicial?: string | null
          link_audiencia_pruebas?: string | null
          lugar_audiencia_inicial?: string | null
          lugar_audiencia_pruebas?: string | null
          medio_de_control?: Database["public"]["Enums"]["cpaca_medio_control"]
          medio_de_control_custom?: string | null
          monitored_process_id?: string | null
          notas?: string | null
          owner_id?: string
          phase?: Database["public"]["Enums"]["cpaca_phase"]
          prorroga_traslado_demanda?: boolean
          radicado?: string | null
          sentencia_favorable?: boolean | null
          tipo_recurso?: string | null
          titulo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cpaca_processes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cpaca_processes_monitored_process_id_fkey"
            columns: ["monitored_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cpaca_processes_owner_id_fkey"
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
      desacato_incidents: {
        Row: {
          apertura_date: string | null
          compliance_deadline: string | null
          compliance_term_days: number | null
          created_at: string
          fallo_date: string | null
          fallo_favorable: boolean | null
          id: string
          incumplimiento_date: string | null
          incumplimiento_notes: string | null
          incumplimiento_reportado: boolean | null
          linked_work_item_id: string | null
          notes: string | null
          owner_id: string
          phase: string
          radicacion_date: string | null
          requerimiento_date: string | null
          segunda_solicitud_date: string | null
          tutela_id: string
          updated_at: string
        }
        Insert: {
          apertura_date?: string | null
          compliance_deadline?: string | null
          compliance_term_days?: number | null
          created_at?: string
          fallo_date?: string | null
          fallo_favorable?: boolean | null
          id?: string
          incumplimiento_date?: string | null
          incumplimiento_notes?: string | null
          incumplimiento_reportado?: boolean | null
          linked_work_item_id?: string | null
          notes?: string | null
          owner_id: string
          phase?: string
          radicacion_date?: string | null
          requerimiento_date?: string | null
          segunda_solicitud_date?: string | null
          tutela_id: string
          updated_at?: string
        }
        Update: {
          apertura_date?: string | null
          compliance_deadline?: string | null
          compliance_term_days?: number | null
          created_at?: string
          fallo_date?: string | null
          fallo_favorable?: boolean | null
          id?: string
          incumplimiento_date?: string | null
          incumplimiento_notes?: string | null
          incumplimiento_reportado?: boolean | null
          linked_work_item_id?: string | null
          notes?: string | null
          owner_id?: string
          phase?: string
          radicacion_date?: string | null
          requerimiento_date?: string | null
          segunda_solicitud_date?: string | null
          tutela_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "desacato_incidents_linked_work_item_id_fkey"
            columns: ["linked_work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desacato_incidents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "desacato_incidents_tutela_id_fkey"
            columns: ["tutela_id"]
            isOneToOne: false
            referencedRelation: "filings"
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
          milestones_detected: number | null
          owner_id: string
          phase_updates: number | null
          rows_failed: number | null
          rows_imported: number | null
          rows_matched: number | null
          rows_skipped_duplicate: number | null
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
          milestones_detected?: number | null
          owner_id: string
          phase_updates?: number | null
          rows_failed?: number | null
          rows_imported?: number | null
          rows_matched?: number | null
          rows_skipped_duplicate?: number | null
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
          milestones_detected?: number | null
          owner_id?: string
          phase_updates?: number | null
          rows_failed?: number | null
          rows_imported?: number | null
          rows_matched?: number | null
          rows_skipped_duplicate?: number | null
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
          case_family: string | null
          case_subtype: string | null
          client_id: string | null
          compliance_deadline: string | null
          compliance_reported: boolean | null
          compliance_reported_at: string | null
          compliance_term_days: number | null
          court_city: string | null
          court_department: string | null
          court_email: string | null
          court_name: string | null
          crawler_enabled: boolean | null
          created_at: string
          demandados: string | null
          demandantes: string | null
          description: string | null
          email_linking_enabled: boolean | null
          expediente_url: string | null
          filing_method: string | null
          filing_type: string
          has_auto_admisorio: boolean | null
          id: string
          is_flagged: boolean | null
          last_crawled_at: string | null
          last_event_at: string | null
          last_reviewed_at: string | null
          linked_process_id: string | null
          matter_id: string
          owner_id: string
          proof_file_path: string | null
          radicado: string | null
          radicado_status:
            | Database["public"]["Enums"]["radicado_verification_status"]
            | null
          rama_judicial_url: string | null
          reparto_email_to: string | null
          reparto_reference: string | null
          scrape_status: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields: Json | null
          sent_at: string | null
          sla_acta_due_at: string | null
          sla_court_reply_due_at: string | null
          sla_receipt_due_at: string | null
          source_links: Json | null
          status: Database["public"]["Enums"]["filing_status"]
          target_authority: string | null
          updated_at: string
        }
        Insert: {
          acta_received_at?: string | null
          case_family?: string | null
          case_subtype?: string | null
          client_id?: string | null
          compliance_deadline?: string | null
          compliance_reported?: boolean | null
          compliance_reported_at?: string | null
          compliance_term_days?: number | null
          court_city?: string | null
          court_department?: string | null
          court_email?: string | null
          court_name?: string | null
          crawler_enabled?: boolean | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          expediente_url?: string | null
          filing_method?: string | null
          filing_type: string
          has_auto_admisorio?: boolean | null
          id?: string
          is_flagged?: boolean | null
          last_crawled_at?: string | null
          last_event_at?: string | null
          last_reviewed_at?: string | null
          linked_process_id?: string | null
          matter_id: string
          owner_id: string
          proof_file_path?: string | null
          radicado?: string | null
          radicado_status?:
            | Database["public"]["Enums"]["radicado_verification_status"]
            | null
          rama_judicial_url?: string | null
          reparto_email_to?: string | null
          reparto_reference?: string | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          sent_at?: string | null
          sla_acta_due_at?: string | null
          sla_court_reply_due_at?: string | null
          sla_receipt_due_at?: string | null
          source_links?: Json | null
          status?: Database["public"]["Enums"]["filing_status"]
          target_authority?: string | null
          updated_at?: string
        }
        Update: {
          acta_received_at?: string | null
          case_family?: string | null
          case_subtype?: string | null
          client_id?: string | null
          compliance_deadline?: string | null
          compliance_reported?: boolean | null
          compliance_reported_at?: string | null
          compliance_term_days?: number | null
          court_city?: string | null
          court_department?: string | null
          court_email?: string | null
          court_name?: string | null
          crawler_enabled?: boolean | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          expediente_url?: string | null
          filing_method?: string | null
          filing_type?: string
          has_auto_admisorio?: boolean | null
          id?: string
          is_flagged?: boolean | null
          last_crawled_at?: string | null
          last_event_at?: string | null
          last_reviewed_at?: string | null
          linked_process_id?: string | null
          matter_id?: string
          owner_id?: string
          proof_file_path?: string | null
          radicado?: string | null
          radicado_status?:
            | Database["public"]["Enums"]["radicado_verification_status"]
            | null
          rama_judicial_url?: string | null
          reparto_email_to?: string | null
          reparto_reference?: string | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          sent_at?: string | null
          sla_acta_due_at?: string | null
          sla_court_reply_due_at?: string | null
          sla_receipt_due_at?: string | null
          source_links?: Json | null
          status?: Database["public"]["Enums"]["filing_status"]
          target_authority?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "filings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "filings_linked_process_id_fkey"
            columns: ["linked_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
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
          cpaca_process_id: string | null
          created_at: string
          filing_id: string | null
          id: string
          is_virtual: boolean | null
          location: string | null
          notes: string | null
          organization_id: string | null
          owner_id: string
          reminder_sent: boolean | null
          scheduled_at: string
          title: string
          updated_at: string
          virtual_link: string | null
          work_item_id: string | null
        }
        Insert: {
          auto_detected?: boolean | null
          cpaca_process_id?: string | null
          created_at?: string
          filing_id?: string | null
          id?: string
          is_virtual?: boolean | null
          location?: string | null
          notes?: string | null
          organization_id?: string | null
          owner_id: string
          reminder_sent?: boolean | null
          scheduled_at: string
          title: string
          updated_at?: string
          virtual_link?: string | null
          work_item_id?: string | null
        }
        Update: {
          auto_detected?: boolean | null
          cpaca_process_id?: string | null
          created_at?: string
          filing_id?: string | null
          id?: string
          is_virtual?: boolean | null
          location?: string | null
          notes?: string | null
          organization_id?: string | null
          owner_id?: string
          reminder_sent?: boolean | null
          scheduled_at?: string
          title?: string
          updated_at?: string
          virtual_link?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hearings_cpaca_process_id_fkey"
            columns: ["cpaca_process_id"]
            isOneToOne: false
            referencedRelation: "cpaca_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hearings_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hearings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hearings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hearings_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
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
          selected_workflow_type: string | null
          source_payload: Json | null
          status: string
          suggested_workflow_type: string | null
          was_overridden: boolean | null
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
          selected_workflow_type?: string | null
          source_payload?: Json | null
          status?: string
          suggested_workflow_type?: string | null
          was_overridden?: boolean | null
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
          selected_workflow_type?: string | null
          source_payload?: Json | null
          status?: string
          suggested_workflow_type?: string | null
          was_overridden?: boolean | null
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
      inbound_attachments: {
        Row: {
          content_hash: string | null
          created_at: string
          filename: string
          id: string
          is_inline: boolean | null
          message_id: string
          mime_type: string | null
          owner_id: string
          size_bytes: number | null
          storage_path: string | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          filename: string
          id?: string
          is_inline?: boolean | null
          message_id: string
          mime_type?: string | null
          owner_id: string
          size_bytes?: number | null
          storage_path?: string | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          filename?: string
          id?: string
          is_inline?: boolean | null
          message_id?: string
          mime_type?: string | null
          owner_id?: string
          size_bytes?: number | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_attachments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_messages: {
        Row: {
          body_preview: string | null
          cc_emails: string[] | null
          created_at: string
          date_header: string | null
          error_log: string | null
          from_email: string
          from_name: string | null
          html_body: string | null
          id: string
          in_reply_to: string | null
          owner_id: string
          processing_status: string
          raw_payload_hash: string
          received_at: string
          references_header: string[] | null
          source_message_id: string | null
          source_provider: string
          subject: string
          text_body: string | null
          thread_id: string | null
          to_emails: string[] | null
          updated_at: string
        }
        Insert: {
          body_preview?: string | null
          cc_emails?: string[] | null
          created_at?: string
          date_header?: string | null
          error_log?: string | null
          from_email: string
          from_name?: string | null
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          owner_id: string
          processing_status?: string
          raw_payload_hash: string
          received_at?: string
          references_header?: string[] | null
          source_message_id?: string | null
          source_provider?: string
          subject?: string
          text_body?: string | null
          thread_id?: string | null
          to_emails?: string[] | null
          updated_at?: string
        }
        Update: {
          body_preview?: string | null
          cc_emails?: string[] | null
          created_at?: string
          date_header?: string | null
          error_log?: string | null
          from_email?: string
          from_name?: string | null
          html_body?: string | null
          id?: string
          in_reply_to?: string | null
          owner_id?: string
          processing_status?: string
          raw_payload_hash?: string
          received_at?: string
          references_header?: string[] | null
          source_message_id?: string | null
          source_provider?: string
          subject?: string
          text_body?: string | null
          thread_id?: string | null
          to_emails?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_owner_id_fkey"
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
      judicial_term_suspensions: {
        Row: {
          active: boolean
          created_at: string
          end_date: string
          id: string
          owner_id: string
          reason: string | null
          scope: string
          scope_value: string | null
          start_date: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_date: string
          id?: string
          owner_id: string
          reason?: string | null
          scope?: string
          scope_value?: string | null
          start_date: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          end_date?: string
          id?: string
          owner_id?: string
          reason?: string | null
          scope?: string
          scope_value?: string | null
          start_date?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "judicial_term_suspensions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_files: {
        Row: {
          created_at: string
          description: string | null
          file_path: string
          file_size: number
          file_type: string | null
          id: string
          matter_id: string
          original_filename: string
          owner_id: string
          uploaded_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          file_path: string
          file_size?: number
          file_type?: string | null
          id?: string
          matter_id: string
          original_filename: string
          owner_id: string
          uploaded_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          file_path?: string
          file_size?: number
          file_type?: string | null
          id?: string
          matter_id?: string
          original_filename?: string
          owner_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_files_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_files_owner_id_fkey"
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
          sharepoint_alerts_dismissed: boolean | null
          sharepoint_url: string | null
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
          sharepoint_alerts_dismissed?: boolean | null
          sharepoint_url?: string | null
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
          sharepoint_alerts_dismissed?: boolean | null
          sharepoint_url?: string | null
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
      message_links: {
        Row: {
          created_at: string
          created_by: string
          dismissed_at: string | null
          entity_id: string
          entity_type: string
          id: string
          link_confidence: number | null
          link_reasons: string[] | null
          link_status: string
          message_id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          dismissed_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          link_confidence?: number | null
          link_reasons?: string[] | null
          link_status?: string
          message_id: string
          owner_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          dismissed_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          link_confidence?: number | null
          link_reasons?: string[] | null
          link_status?: string
          message_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_links_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "inbound_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_links_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_mapping_patterns: {
        Row: {
          active: boolean | null
          base_confidence: number | null
          created_at: string
          id: string
          is_system: boolean | null
          milestone_type: string
          notes: string | null
          notificacion_subtype:
            | Database["public"]["Enums"]["notificacion_subtype"]
            | null
          owner_id: string | null
          pattern_keywords: string[]
          pattern_regex: string
          priority: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          base_confidence?: number | null
          created_at?: string
          id?: string
          is_system?: boolean | null
          milestone_type: string
          notes?: string | null
          notificacion_subtype?:
            | Database["public"]["Enums"]["notificacion_subtype"]
            | null
          owner_id?: string | null
          pattern_keywords?: string[]
          pattern_regex: string
          priority?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          base_confidence?: number | null
          created_at?: string
          id?: string
          is_system?: boolean | null
          milestone_type?: string
          notes?: string | null
          notificacion_subtype?:
            | Database["public"]["Enums"]["notificacion_subtype"]
            | null
          owner_id?: string | null
          pattern_keywords?: string[]
          pattern_regex?: string
          priority?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_mapping_patterns_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_processes: {
        Row: {
          admin_phase: string | null
          autoridad: string | null
          case_family: string | null
          case_subtype: string | null
          client_id: string | null
          correo_autoridad: string | null
          cpnu_confirmed: boolean | null
          cpnu_confirmed_at: string | null
          created_at: string
          demandados: string | null
          demandantes: string | null
          department: string | null
          dependencia: string | null
          despacho_name: string | null
          email_linking_enabled: boolean | null
          entidad: string | null
          expediente_administrativo: string | null
          expediente_digital_url: string | null
          has_auto_admisorio: boolean | null
          id: string
          is_flagged: boolean | null
          juez_ponente: string | null
          jurisdiction: string | null
          last_action_date: string | null
          last_action_date_raw: string | null
          last_change_at: string | null
          last_checked_at: string | null
          last_reviewed_at: string | null
          linked_filing_id: string | null
          monitoring_enabled: boolean | null
          monitoring_schedule: string | null
          municipality: string | null
          notes: string | null
          owner_id: string
          phase: Database["public"]["Enums"]["process_phase"] | null
          process_type: string
          radicado: string
          radicado_status:
            | Database["public"]["Enums"]["radicado_verification_status"]
            | null
          scrape_status: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields: Json | null
          source: string | null
          source_links: Json | null
          source_payload: Json | null
          source_run_id: string | null
          sources_enabled: Json | null
          tipo_actuacion: string | null
          total_actuaciones: number | null
          total_sujetos_procesales: number | null
          updated_at: string
        }
        Insert: {
          admin_phase?: string | null
          autoridad?: string | null
          case_family?: string | null
          case_subtype?: string | null
          client_id?: string | null
          correo_autoridad?: string | null
          cpnu_confirmed?: boolean | null
          cpnu_confirmed_at?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          department?: string | null
          dependencia?: string | null
          despacho_name?: string | null
          email_linking_enabled?: boolean | null
          entidad?: string | null
          expediente_administrativo?: string | null
          expediente_digital_url?: string | null
          has_auto_admisorio?: boolean | null
          id?: string
          is_flagged?: boolean | null
          juez_ponente?: string | null
          jurisdiction?: string | null
          last_action_date?: string | null
          last_action_date_raw?: string | null
          last_change_at?: string | null
          last_checked_at?: string | null
          last_reviewed_at?: string | null
          linked_filing_id?: string | null
          monitoring_enabled?: boolean | null
          monitoring_schedule?: string | null
          municipality?: string | null
          notes?: string | null
          owner_id: string
          phase?: Database["public"]["Enums"]["process_phase"] | null
          process_type?: string
          radicado: string
          radicado_status?:
            | Database["public"]["Enums"]["radicado_verification_status"]
            | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          source?: string | null
          source_links?: Json | null
          source_payload?: Json | null
          source_run_id?: string | null
          sources_enabled?: Json | null
          tipo_actuacion?: string | null
          total_actuaciones?: number | null
          total_sujetos_procesales?: number | null
          updated_at?: string
        }
        Update: {
          admin_phase?: string | null
          autoridad?: string | null
          case_family?: string | null
          case_subtype?: string | null
          client_id?: string | null
          correo_autoridad?: string | null
          cpnu_confirmed?: boolean | null
          cpnu_confirmed_at?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          department?: string | null
          dependencia?: string | null
          despacho_name?: string | null
          email_linking_enabled?: boolean | null
          entidad?: string | null
          expediente_administrativo?: string | null
          expediente_digital_url?: string | null
          has_auto_admisorio?: boolean | null
          id?: string
          is_flagged?: boolean | null
          juez_ponente?: string | null
          jurisdiction?: string | null
          last_action_date?: string | null
          last_action_date_raw?: string | null
          last_change_at?: string | null
          last_checked_at?: string | null
          last_reviewed_at?: string | null
          linked_filing_id?: string | null
          monitoring_enabled?: boolean | null
          monitoring_schedule?: string | null
          municipality?: string | null
          notes?: string | null
          owner_id?: string
          phase?: Database["public"]["Enums"]["process_phase"] | null
          process_type?: string
          radicado?: string
          radicado_status?:
            | Database["public"]["Enums"]["radicado_verification_status"]
            | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          source?: string | null
          source_links?: Json | null
          source_payload?: Json | null
          source_run_id?: string | null
          sources_enabled?: Json | null
          tipo_actuacion?: string | null
          total_actuaciones?: number | null
          total_sujetos_procesales?: number | null
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
            foreignKeyName: "monitored_processes_linked_filing_id_fkey"
            columns: ["linked_filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
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
      organizations: {
        Row: {
          brand_logo_url: string | null
          brand_primary_color: string | null
          brand_tagline: string | null
          created_at: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          brand_logo_url?: string | null
          brand_primary_color?: string | null
          brand_tagline?: string | null
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          brand_logo_url?: string | null
          brand_primary_color?: string | null
          brand_tagline?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      peticion_alerts: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          owner_id: string
          peticion_id: string
          sent_at: string | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          owner_id: string
          peticion_id: string
          sent_at?: string | null
          severity: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          owner_id?: string
          peticion_id?: string
          sent_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "peticion_alerts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peticion_alerts_peticion_id_fkey"
            columns: ["peticion_id"]
            isOneToOne: false
            referencedRelation: "peticiones"
            referencedColumns: ["id"]
          },
        ]
      }
      peticiones: {
        Row: {
          client_id: string | null
          constancia_received_at: string | null
          created_at: string
          deadline_at: string | null
          description: string | null
          entity_address: string | null
          entity_email: string | null
          entity_name: string
          entity_type: string | null
          escalated_to_tutela: boolean | null
          filed_at: string | null
          id: string
          is_flagged: boolean | null
          notes: string | null
          owner_id: string
          phase: Database["public"]["Enums"]["peticion_phase"]
          proof_file_path: string | null
          prorogation_deadline_at: string | null
          prorogation_requested: boolean | null
          prorogation_started_at: string | null
          radicado: string | null
          response_file_path: string | null
          response_received_at: string | null
          subject: string
          tutela_filing_id: string | null
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          constancia_received_at?: string | null
          created_at?: string
          deadline_at?: string | null
          description?: string | null
          entity_address?: string | null
          entity_email?: string | null
          entity_name: string
          entity_type?: string | null
          escalated_to_tutela?: boolean | null
          filed_at?: string | null
          id?: string
          is_flagged?: boolean | null
          notes?: string | null
          owner_id: string
          phase?: Database["public"]["Enums"]["peticion_phase"]
          proof_file_path?: string | null
          prorogation_deadline_at?: string | null
          prorogation_requested?: boolean | null
          prorogation_started_at?: string | null
          radicado?: string | null
          response_file_path?: string | null
          response_received_at?: string | null
          subject: string
          tutela_filing_id?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          constancia_received_at?: string | null
          created_at?: string
          deadline_at?: string | null
          description?: string | null
          entity_address?: string | null
          entity_email?: string | null
          entity_name?: string
          entity_type?: string | null
          escalated_to_tutela?: boolean | null
          filed_at?: string | null
          id?: string
          is_flagged?: boolean | null
          notes?: string | null
          owner_id?: string
          phase?: Database["public"]["Enums"]["peticion_phase"]
          proof_file_path?: string | null
          prorogation_deadline_at?: string | null
          prorogation_requested?: boolean | null
          prorogation_started_at?: string | null
          radicado?: string | null
          response_file_path?: string | null
          response_received_at?: string | null
          subject?: string
          tutela_filing_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "peticiones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peticiones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peticiones_tutela_filing_id_fkey"
            columns: ["tutela_filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
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
          detected_milestones: Json | null
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
          detected_milestones?: Json | null
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
          detected_milestones?: Json | null
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
          default_alert_email: string | null
          email_reminders_enabled: boolean | null
          estados_import_interval_days: number | null
          firm_name: string | null
          firma_abogado_cc: string | null
          firma_abogado_correo: string | null
          firma_abogado_nombre_completo: string | null
          firma_abogado_tp: string | null
          full_name: string | null
          hearing_reminder_days: Json | null
          id: string
          last_estados_import_at: string | null
          organization_id: string | null
          reminder_email: string | null
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
          default_alert_email?: string | null
          email_reminders_enabled?: boolean | null
          estados_import_interval_days?: number | null
          firm_name?: string | null
          firma_abogado_cc?: string | null
          firma_abogado_correo?: string | null
          firma_abogado_nombre_completo?: string | null
          firma_abogado_tp?: string | null
          full_name?: string | null
          hearing_reminder_days?: Json | null
          id: string
          last_estados_import_at?: string | null
          organization_id?: string | null
          reminder_email?: string | null
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
          default_alert_email?: string | null
          email_reminders_enabled?: boolean | null
          estados_import_interval_days?: number | null
          firm_name?: string | null
          firma_abogado_cc?: string | null
          firma_abogado_correo?: string | null
          firma_abogado_nombre_completo?: string | null
          firma_abogado_tp?: string | null
          full_name?: string | null
          hearing_reminder_days?: Json | null
          id?: string
          last_estados_import_at?: string | null
          organization_id?: string | null
          reminder_email?: string | null
          reparto_directory?: Json | null
          signature_block?: string | null
          sla_acta_days?: number | null
          sla_court_reply_days?: number | null
          sla_receipt_hours?: number | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      scraping_jobs: {
        Row: {
          actuaciones_found: number | null
          adapter_name: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          filing_id: string | null
          finished_at: string | null
          id: string
          milestones_suggested: number | null
          monitored_process_id: string | null
          owner_id: string
          radicado: string
          request_payload: Json | null
          response_payload: Json | null
          started_at: string | null
          status: string
        }
        Insert: {
          actuaciones_found?: number | null
          adapter_name?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          filing_id?: string | null
          finished_at?: string | null
          id?: string
          milestones_suggested?: number | null
          monitored_process_id?: string | null
          owner_id: string
          radicado: string
          request_payload?: Json | null
          response_payload?: Json | null
          started_at?: string | null
          status?: string
        }
        Update: {
          actuaciones_found?: number | null
          adapter_name?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          filing_id?: string | null
          finished_at?: string | null
          id?: string
          milestones_suggested?: number | null
          monitored_process_id?: string | null
          owner_id?: string
          radicado?: string
          request_payload?: Json | null
          response_payload?: Json | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraping_jobs_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scraping_jobs_monitored_process_id_fkey"
            columns: ["monitored_process_id"]
            isOneToOne: false
            referencedRelation: "monitored_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scraping_jobs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean | null
          created_at: string | null
          display_name: string
          features: Json | null
          id: string
          max_clients: number | null
          max_filings: number | null
          name: string
          price_cop: number
          trial_days: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          display_name: string
          features?: Json | null
          id?: string
          max_clients?: number | null
          max_filings?: number | null
          name: string
          price_cop?: number
          trial_days?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          display_name?: string
          features?: Json | null
          id?: string
          max_clients?: number | null
          max_filings?: number | null
          name?: string
          price_cop?: number
          trial_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          organization_id: string
          payment_method: string | null
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id: string
          payment_method?: string | null
          plan_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          organization_id?: string
          payment_method?: string | null
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
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
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          last_used_at: string | null
          owner_id: string
          provider: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          owner_id: string
          provider?: string
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          owner_id?: string
          provider?: string
          token?: string
        }
        Relationships: []
      }
      work_item_acts: {
        Row: {
          act_date: string | null
          act_date_raw: string | null
          act_type: string | null
          created_at: string
          description: string
          hash_fingerprint: string
          id: string
          owner_id: string
          raw_data: Json | null
          source: string | null
          source_reference: string | null
          work_item_id: string
        }
        Insert: {
          act_date?: string | null
          act_date_raw?: string | null
          act_type?: string | null
          created_at?: string
          description: string
          hash_fingerprint: string
          id?: string
          owner_id: string
          raw_data?: Json | null
          source?: string | null
          source_reference?: string | null
          work_item_id: string
        }
        Update: {
          act_date?: string | null
          act_date_raw?: string | null
          act_type?: string | null
          created_at?: string
          description?: string
          hash_fingerprint?: string
          id?: string
          owner_id?: string
          raw_data?: Json | null
          source?: string | null
          source_reference?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_acts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_acts_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_deadlines: {
        Row: {
          business_days_count: number | null
          calculation_meta: Json | null
          created_at: string
          deadline_date: string
          deadline_type: string
          description: string | null
          id: string
          label: string
          met_at: string | null
          notes: string | null
          owner_id: string
          status: string
          trigger_date: string
          trigger_event: string
          updated_at: string
          work_item_id: string
        }
        Insert: {
          business_days_count?: number | null
          calculation_meta?: Json | null
          created_at?: string
          deadline_date: string
          deadline_type: string
          description?: string | null
          id?: string
          label: string
          met_at?: string | null
          notes?: string | null
          owner_id: string
          status?: string
          trigger_date: string
          trigger_event: string
          updated_at?: string
          work_item_id: string
        }
        Update: {
          business_days_count?: number | null
          calculation_meta?: Json | null
          created_at?: string
          deadline_date?: string
          deadline_type?: string
          description?: string | null
          id?: string
          label?: string
          met_at?: string | null
          notes?: string | null
          owner_id?: string
          status?: string
          trigger_date?: string
          trigger_event?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_deadlines_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          authority_city: string | null
          authority_department: string | null
          authority_email: string | null
          authority_name: string | null
          auto_admisorio_date: string | null
          cgp_class: string | null
          cgp_cuantia: string | null
          cgp_instancia: string | null
          cgp_phase: Database["public"]["Enums"]["cgp_phase"] | null
          cgp_phase_source:
            | Database["public"]["Enums"]["cgp_phase_source"]
            | null
          cgp_variant: string | null
          client_id: string | null
          created_at: string
          demandados: string | null
          demandantes: string | null
          description: string | null
          email_linking_enabled: boolean | null
          expediente_url: string | null
          filing_date: string | null
          id: string
          is_flagged: boolean | null
          last_action_date: string | null
          last_action_description: string | null
          last_checked_at: string | null
          last_crawled_at: string | null
          legacy_admin_process_id: string | null
          legacy_cgp_item_id: string | null
          legacy_cpaca_id: string | null
          legacy_filing_id: string | null
          legacy_peticion_id: string | null
          legacy_process_id: string | null
          matter_id: string | null
          migration_note: string | null
          monitoring_enabled: boolean | null
          notes: string | null
          notification_effective_date: string | null
          notification_substatus: string | null
          owner_id: string
          radicado: string | null
          radicado_verified: boolean | null
          scrape_status: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields: Json | null
          sharepoint_url: string | null
          source: Database["public"]["Enums"]["item_source"]
          source_payload: Json | null
          source_reference: string | null
          stage: string
          status: Database["public"]["Enums"]["item_status"]
          title: string | null
          total_actuaciones: number | null
          updated_at: string
          workflow_type: Database["public"]["Enums"]["workflow_type"]
        }
        Insert: {
          authority_city?: string | null
          authority_department?: string | null
          authority_email?: string | null
          authority_name?: string | null
          auto_admisorio_date?: string | null
          cgp_class?: string | null
          cgp_cuantia?: string | null
          cgp_instancia?: string | null
          cgp_phase?: Database["public"]["Enums"]["cgp_phase"] | null
          cgp_phase_source?:
            | Database["public"]["Enums"]["cgp_phase_source"]
            | null
          cgp_variant?: string | null
          client_id?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          expediente_url?: string | null
          filing_date?: string | null
          id?: string
          is_flagged?: boolean | null
          last_action_date?: string | null
          last_action_description?: string | null
          last_checked_at?: string | null
          last_crawled_at?: string | null
          legacy_admin_process_id?: string | null
          legacy_cgp_item_id?: string | null
          legacy_cpaca_id?: string | null
          legacy_filing_id?: string | null
          legacy_peticion_id?: string | null
          legacy_process_id?: string | null
          matter_id?: string | null
          migration_note?: string | null
          monitoring_enabled?: boolean | null
          notes?: string | null
          notification_effective_date?: string | null
          notification_substatus?: string | null
          owner_id: string
          radicado?: string | null
          radicado_verified?: boolean | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          sharepoint_url?: string | null
          source?: Database["public"]["Enums"]["item_source"]
          source_payload?: Json | null
          source_reference?: string | null
          stage: string
          status?: Database["public"]["Enums"]["item_status"]
          title?: string | null
          total_actuaciones?: number | null
          updated_at?: string
          workflow_type: Database["public"]["Enums"]["workflow_type"]
        }
        Update: {
          authority_city?: string | null
          authority_department?: string | null
          authority_email?: string | null
          authority_name?: string | null
          auto_admisorio_date?: string | null
          cgp_class?: string | null
          cgp_cuantia?: string | null
          cgp_instancia?: string | null
          cgp_phase?: Database["public"]["Enums"]["cgp_phase"] | null
          cgp_phase_source?:
            | Database["public"]["Enums"]["cgp_phase_source"]
            | null
          cgp_variant?: string | null
          client_id?: string | null
          created_at?: string
          demandados?: string | null
          demandantes?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          expediente_url?: string | null
          filing_date?: string | null
          id?: string
          is_flagged?: boolean | null
          last_action_date?: string | null
          last_action_description?: string | null
          last_checked_at?: string | null
          last_crawled_at?: string | null
          legacy_admin_process_id?: string | null
          legacy_cgp_item_id?: string | null
          legacy_cpaca_id?: string | null
          legacy_filing_id?: string | null
          legacy_peticion_id?: string | null
          legacy_process_id?: string | null
          matter_id?: string | null
          migration_note?: string | null
          monitoring_enabled?: boolean | null
          notes?: string | null
          notification_effective_date?: string | null
          notification_substatus?: string | null
          owner_id?: string
          radicado?: string | null
          radicado_verified?: boolean | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          sharepoint_url?: string | null
          source?: Database["public"]["Enums"]["item_source"]
          source_payload?: Json | null
          source_reference?: string | null
          stage?: string
          status?: Database["public"]["Enums"]["item_status"]
          title?: string | null
          total_actuaciones?: number | null
          updated_at?: string
          workflow_type?: Database["public"]["Enums"]["workflow_type"]
        }
        Relationships: [
          {
            foreignKeyName: "work_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_matter_id_fkey"
            columns: ["matter_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_owner_id_fkey"
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
      get_user_organization_id: { Args: never; Returns: string }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_severity: "INFO" | "WARN" | "CRITICAL"
      app_role: "owner" | "admin" | "member"
      cgp_duration_unit: "BUSINESS_DAYS" | "CALENDAR_DAYS" | "MONTHS" | "YEARS"
      cgp_milestone_type:
        | "DEMANDA_RADICADA"
        | "AUTO_ADMISORIO"
        | "MANDAMIENTO_DE_PAGO"
        | "NOTIFICACION_EVENT"
        | "AUTO_SEGUIR_ADELANTE_EJECUCION"
        | "TRASLADO_EVENT"
        | "RECURSO_INTERPUESTO"
        | "RECURSO_DECIDIDO"
        | "AUTO_ADMISORIO_NOTIFICADO"
        | "MANDAMIENTO_EJECUTIVO_NOTIFICADO"
        | "REQUERIMIENTO_PAGO_NOTIFICADO"
        | "TRASLADO_EXCEPCIONES_NOTIFICADO"
        | "TRASLADO_DEMANDA_NOTIFICADO"
        | "CONTESTACION_PRESENTADA"
        | "EXCEPCIONES_PROPUESTAS"
        | "EXCEPCIONES_RESUELTAS"
        | "RECURSO_REPOSICION_INTERPUESTO"
        | "RECURSO_REPOSICION_RESUELTO"
        | "RECURSO_APELACION_INTERPUESTO"
        | "RECURSO_APELACION_CONCEDIDO"
        | "RECURSO_APELACION_RESUELTO"
        | "RECURSO_SUPLICA_INTERPUESTO"
        | "RECURSO_QUEJA_INTERPUESTO"
        | "EXPEDIENTE_AL_DESPACHO"
        | "EXPEDIENTE_A_SECRETARIA"
        | "AUDIENCIA_PROGRAMADA"
        | "AUDIENCIA_CELEBRADA"
        | "SENTENCIA_PRIMERA_INSTANCIA"
        | "SENTENCIA_SEGUNDA_INSTANCIA"
        | "EXPEDIENTE_RECIBIDO_SUPERIOR"
        | "ULTIMA_ACTUACION"
        | "SILENCIO_DEUDOR"
        | "OPOSICION_MONITORIO"
        | "EMBARGO_SECUESTRO_PRACTICADO"
        | "SENTENCIA_EJECUTORIA"
        | "AVALUO_BIENES"
        | "CUSTOM"
      cgp_phase: "FILING" | "PROCESS"
      cgp_phase_source: "AUTO" | "MANUAL"
      cgp_process_type:
        | "VERBAL"
        | "VERBAL_SUMARIO"
        | "MONITORIO"
        | "EJECUTIVO"
        | "EJECUTIVO_HIPOTECARIO"
        | "RECURSOS"
        | "GENERAL"
      cgp_start_rule:
        | "NEXT_DAY_AFTER_NOTIFICATION"
        | "SAME_DAY_IN_AUDIENCE"
        | "NEXT_DAY_AFTER_LAST_NOTIFICATION"
        | "IMMEDIATE"
      cgp_status: "ACTIVE" | "INACTIVE" | "CLOSED" | "REJECTED"
      cgp_term_status:
        | "PENDING"
        | "RUNNING"
        | "PAUSED"
        | "EXPIRED"
        | "SATISFIED"
        | "NOT_APPLICABLE"
        | "INTERRUPTED"
      cpaca_estado_caducidad: "EN_TERMINO" | "RIESGO" | "VENCIDO" | "NO_APLICA"
      cpaca_estado_conciliacion:
        | "PENDIENTE"
        | "PROGRAMADA"
        | "CELEBRADA_SIN_ACUERDO"
        | "CON_ACUERDO"
        | "CONSTANCIA_EXPEDIDA"
      cpaca_medio_control:
        | "NULIDAD_RESTABLECIMIENTO"
        | "NULIDAD_SIMPLE"
        | "REPARACION_DIRECTA"
        | "CONTROVERSIAS_CONTRACTUALES"
        | "NULIDAD_ELECTORAL"
        | "REPETICION"
        | "OTRO"
      cpaca_phase:
        | "PRECONTENCIOSO"
        | "DEMANDA_POR_RADICAR"
        | "DEMANDA_RADICADA"
        | "AUTO_ADMISORIO"
        | "NOTIFICACION_TRASLADOS"
        | "TRASLADO_DEMANDA"
        | "REFORMA_DEMANDA"
        | "TRASLADO_EXCEPCIONES"
        | "AUDIENCIA_INICIAL"
        | "AUDIENCIA_PRUEBAS"
        | "ALEGATOS_SENTENCIA"
        | "RECURSOS"
        | "EJECUCION_CUMPLIMIENTO"
        | "ARCHIVADO"
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
      item_source:
        | "ICARUS_IMPORT"
        | "SCRAPE_API"
        | "MANUAL"
        | "EMAIL_IMPORT"
        | "MIGRATION"
      item_status: "ACTIVE" | "INACTIVE" | "CLOSED" | "ARCHIVED"
      milestone_source: "USER" | "RAMA_SCRAPE" | "SYSTEM" | "ICARUS_IMPORT"
      notificacion_subtype:
        | "NOTIFICACION_AUTO_ADMISORIO"
        | "NOTIFICACION_MANDAMIENTO_PAGO"
        | "NOTIFICACION_PERSONAL"
        | "NOTIFICACION_POR_AVISO"
        | "NOTIFICACION_ESTADO"
        | "NOTIFICACION_ELECTRONICA"
        | "NOTIFICACION_GENERAL"
      peticion_phase:
        | "PETICION_RADICADA"
        | "CONSTANCIA_RADICACION"
        | "RESPUESTA"
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
      process_phase:
        | "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR"
        | "PENDIENTE_NOTIFICACION_PERSONAL"
        | "PENDIENTE_NOTIFICACION_AVISO_EMPLAZAMIENTO"
        | "PENDIENTE_CONTESTAR_EXCEPCIONES_PREVIAS"
        | "PENDIENTE_PRONUNCIARSE_EXCEPCIONES"
        | "PENDIENTE_AUDIENCIA_INICIAL"
        | "PENDIENTE_AUDIENCIA_INSTRUCCION"
        | "PENDIENTE_ALEGATOS_SENTENCIA"
        | "PENDIENTE_SUSTENTAR_APELACION"
      radicado_verification_status:
        | "NOT_PROVIDED"
        | "PROVIDED_NOT_VERIFIED"
        | "VERIFIED_FOUND"
        | "NOT_FOUND"
        | "LOOKUP_UNAVAILABLE"
        | "AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION"
      scrape_status:
        | "NOT_ATTEMPTED"
        | "IN_PROGRESS"
        | "SUCCESS"
        | "FAILED"
        | "PARTIAL_SUCCESS"
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
      workflow_type: "CGP" | "PETICION" | "TUTELA" | "GOV_PROCEDURE" | "CPACA"
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
      app_role: ["owner", "admin", "member"],
      cgp_duration_unit: ["BUSINESS_DAYS", "CALENDAR_DAYS", "MONTHS", "YEARS"],
      cgp_milestone_type: [
        "DEMANDA_RADICADA",
        "AUTO_ADMISORIO",
        "MANDAMIENTO_DE_PAGO",
        "NOTIFICACION_EVENT",
        "AUTO_SEGUIR_ADELANTE_EJECUCION",
        "TRASLADO_EVENT",
        "RECURSO_INTERPUESTO",
        "RECURSO_DECIDIDO",
        "AUTO_ADMISORIO_NOTIFICADO",
        "MANDAMIENTO_EJECUTIVO_NOTIFICADO",
        "REQUERIMIENTO_PAGO_NOTIFICADO",
        "TRASLADO_EXCEPCIONES_NOTIFICADO",
        "TRASLADO_DEMANDA_NOTIFICADO",
        "CONTESTACION_PRESENTADA",
        "EXCEPCIONES_PROPUESTAS",
        "EXCEPCIONES_RESUELTAS",
        "RECURSO_REPOSICION_INTERPUESTO",
        "RECURSO_REPOSICION_RESUELTO",
        "RECURSO_APELACION_INTERPUESTO",
        "RECURSO_APELACION_CONCEDIDO",
        "RECURSO_APELACION_RESUELTO",
        "RECURSO_SUPLICA_INTERPUESTO",
        "RECURSO_QUEJA_INTERPUESTO",
        "EXPEDIENTE_AL_DESPACHO",
        "EXPEDIENTE_A_SECRETARIA",
        "AUDIENCIA_PROGRAMADA",
        "AUDIENCIA_CELEBRADA",
        "SENTENCIA_PRIMERA_INSTANCIA",
        "SENTENCIA_SEGUNDA_INSTANCIA",
        "EXPEDIENTE_RECIBIDO_SUPERIOR",
        "ULTIMA_ACTUACION",
        "SILENCIO_DEUDOR",
        "OPOSICION_MONITORIO",
        "EMBARGO_SECUESTRO_PRACTICADO",
        "SENTENCIA_EJECUTORIA",
        "AVALUO_BIENES",
        "CUSTOM",
      ],
      cgp_phase: ["FILING", "PROCESS"],
      cgp_phase_source: ["AUTO", "MANUAL"],
      cgp_process_type: [
        "VERBAL",
        "VERBAL_SUMARIO",
        "MONITORIO",
        "EJECUTIVO",
        "EJECUTIVO_HIPOTECARIO",
        "RECURSOS",
        "GENERAL",
      ],
      cgp_start_rule: [
        "NEXT_DAY_AFTER_NOTIFICATION",
        "SAME_DAY_IN_AUDIENCE",
        "NEXT_DAY_AFTER_LAST_NOTIFICATION",
        "IMMEDIATE",
      ],
      cgp_status: ["ACTIVE", "INACTIVE", "CLOSED", "REJECTED"],
      cgp_term_status: [
        "PENDING",
        "RUNNING",
        "PAUSED",
        "EXPIRED",
        "SATISFIED",
        "NOT_APPLICABLE",
        "INTERRUPTED",
      ],
      cpaca_estado_caducidad: ["EN_TERMINO", "RIESGO", "VENCIDO", "NO_APLICA"],
      cpaca_estado_conciliacion: [
        "PENDIENTE",
        "PROGRAMADA",
        "CELEBRADA_SIN_ACUERDO",
        "CON_ACUERDO",
        "CONSTANCIA_EXPEDIDA",
      ],
      cpaca_medio_control: [
        "NULIDAD_RESTABLECIMIENTO",
        "NULIDAD_SIMPLE",
        "REPARACION_DIRECTA",
        "CONTROVERSIAS_CONTRACTUALES",
        "NULIDAD_ELECTORAL",
        "REPETICION",
        "OTRO",
      ],
      cpaca_phase: [
        "PRECONTENCIOSO",
        "DEMANDA_POR_RADICAR",
        "DEMANDA_RADICADA",
        "AUTO_ADMISORIO",
        "NOTIFICACION_TRASLADOS",
        "TRASLADO_DEMANDA",
        "REFORMA_DEMANDA",
        "TRASLADO_EXCEPCIONES",
        "AUDIENCIA_INICIAL",
        "AUDIENCIA_PRUEBAS",
        "ALEGATOS_SENTENCIA",
        "RECURSOS",
        "EJECUCION_CUMPLIMIENTO",
        "ARCHIVADO",
      ],
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
      item_source: [
        "ICARUS_IMPORT",
        "SCRAPE_API",
        "MANUAL",
        "EMAIL_IMPORT",
        "MIGRATION",
      ],
      item_status: ["ACTIVE", "INACTIVE", "CLOSED", "ARCHIVED"],
      milestone_source: ["USER", "RAMA_SCRAPE", "SYSTEM", "ICARUS_IMPORT"],
      notificacion_subtype: [
        "NOTIFICACION_AUTO_ADMISORIO",
        "NOTIFICACION_MANDAMIENTO_PAGO",
        "NOTIFICACION_PERSONAL",
        "NOTIFICACION_POR_AVISO",
        "NOTIFICACION_ESTADO",
        "NOTIFICACION_ELECTRONICA",
        "NOTIFICACION_GENERAL",
      ],
      peticion_phase: [
        "PETICION_RADICADA",
        "CONSTANCIA_RADICACION",
        "RESPUESTA",
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
      process_phase: [
        "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR",
        "PENDIENTE_NOTIFICACION_PERSONAL",
        "PENDIENTE_NOTIFICACION_AVISO_EMPLAZAMIENTO",
        "PENDIENTE_CONTESTAR_EXCEPCIONES_PREVIAS",
        "PENDIENTE_PRONUNCIARSE_EXCEPCIONES",
        "PENDIENTE_AUDIENCIA_INICIAL",
        "PENDIENTE_AUDIENCIA_INSTRUCCION",
        "PENDIENTE_ALEGATOS_SENTENCIA",
        "PENDIENTE_SUSTENTAR_APELACION",
      ],
      radicado_verification_status: [
        "NOT_PROVIDED",
        "PROVIDED_NOT_VERIFIED",
        "VERIFIED_FOUND",
        "NOT_FOUND",
        "LOOKUP_UNAVAILABLE",
        "AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION",
      ],
      scrape_status: [
        "NOT_ATTEMPTED",
        "IN_PROGRESS",
        "SUCCESS",
        "FAILED",
        "PARTIAL_SUCCESS",
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
      workflow_type: ["CGP", "PETICION", "TUTELA", "GOV_PROCEDURE", "CPACA"],
    },
  },
} as const
