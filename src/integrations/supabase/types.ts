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
      act_provenance: {
        Row: {
          first_seen_at: string
          id: string
          last_seen_at: string
          provider_event_id: string | null
          provider_instance_id: string
          work_item_act_id: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          provider_event_id?: string | null
          provider_instance_id: string
          work_item_act_id: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          provider_event_id?: string | null
          provider_instance_id?: string
          work_item_act_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "act_provenance_provider_instance_id_fkey"
            columns: ["provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      actuaciones: {
        Row: {
          act_date: string | null
          act_date_raw: string | null
          act_time: string | null
          act_type_guess: string | null
          adapter_name: string | null
          anexos_count: number | null
          attachments: Json | null
          confidence: number | null
          created_at: string
          estado: string | null
          fecha_registro: string | null
          hash_fingerprint: string
          id: string
          indice: string | null
          normalized_text: string
          organization_id: string | null
          owner_id: string
          raw_data: Json | null
          raw_text: string
          source: string
          source_url: string | null
          work_item_id: string | null
        }
        Insert: {
          act_date?: string | null
          act_date_raw?: string | null
          act_time?: string | null
          act_type_guess?: string | null
          adapter_name?: string | null
          anexos_count?: number | null
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          estado?: string | null
          fecha_registro?: string | null
          hash_fingerprint: string
          id?: string
          indice?: string | null
          normalized_text: string
          organization_id?: string | null
          owner_id: string
          raw_data?: Json | null
          raw_text: string
          source?: string
          source_url?: string | null
          work_item_id?: string | null
        }
        Update: {
          act_date?: string | null
          act_date_raw?: string | null
          act_time?: string | null
          act_type_guess?: string | null
          adapter_name?: string | null
          anexos_count?: number | null
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          estado?: string | null
          fecha_registro?: string | null
          hash_fingerprint?: string
          id?: string
          indice?: string | null
          normalized_text?: string
          organization_id?: string | null
          owner_id?: string
          raw_data?: Json | null
          raw_text?: string
          source?: string
          source_url?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actuaciones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actuaciones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actuaciones_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_daily_digests: {
        Row: {
          actions_executed_24h: number | null
          content_markdown: string
          critical_violations: number | null
          digest_date: string
          freshness_sla_rate: number | null
          generated_at: string | null
          id: string
          platform_health: string | null
          summary_data: Json | null
          total_items_monitored: number | null
          total_orgs: number | null
        }
        Insert: {
          actions_executed_24h?: number | null
          content_markdown: string
          critical_violations?: number | null
          digest_date: string
          freshness_sla_rate?: number | null
          generated_at?: string | null
          id?: string
          platform_health?: string | null
          summary_data?: Json | null
          total_items_monitored?: number | null
          total_orgs?: number | null
        }
        Update: {
          actions_executed_24h?: number | null
          content_markdown?: string
          critical_violations?: number | null
          digest_date?: string
          freshness_sla_rate?: number | null
          generated_at?: string | null
          id?: string
          platform_health?: string | null
          summary_data?: Json | null
          total_items_monitored?: number | null
          total_orgs?: number | null
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          audit_log_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string
          organization_id: string
          title: string
          type: string
        }
        Insert: {
          audit_log_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          organization_id: string
          title: string
          type?: string
        }
        Update: {
          audit_log_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          organization_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notifications_audit_log_id_fkey"
            columns: ["audit_log_id"]
            isOneToOne: false
            referencedRelation: "audit_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_instances: {
        Row: {
          acknowledged_at: string | null
          actions: Json | null
          alert_rule_id: string | null
          alert_source: string | null
          alert_type: string | null
          created_at: string
          dismissed_at: string | null
          emailed_at: string | null
          entity_id: string
          entity_type: string
          fingerprint: string | null
          fired_at: string
          id: string
          is_notified_email: boolean
          message: string
          next_fire_at: string | null
          notified_email_at: string | null
          organization_id: string | null
          owner_id: string
          payload: Json | null
          read_at: string | null
          resolved_at: string | null
          seen_at: string | null
          sent_at: string | null
          severity: string
          snoozed_until: string | null
          status: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          actions?: Json | null
          alert_rule_id?: string | null
          alert_source?: string | null
          alert_type?: string | null
          created_at?: string
          dismissed_at?: string | null
          emailed_at?: string | null
          entity_id: string
          entity_type: string
          fingerprint?: string | null
          fired_at?: string
          id?: string
          is_notified_email?: boolean
          message: string
          next_fire_at?: string | null
          notified_email_at?: string | null
          organization_id?: string | null
          owner_id: string
          payload?: Json | null
          read_at?: string | null
          resolved_at?: string | null
          seen_at?: string | null
          sent_at?: string | null
          severity?: string
          snoozed_until?: string | null
          status?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          actions?: Json | null
          alert_rule_id?: string | null
          alert_source?: string | null
          alert_type?: string | null
          created_at?: string
          dismissed_at?: string | null
          emailed_at?: string | null
          entity_id?: string
          entity_type?: string
          fingerprint?: string | null
          fired_at?: string
          id?: string
          is_notified_email?: boolean
          message?: string
          next_fire_at?: string | null
          notified_email_at?: string | null
          organization_id?: string | null
          owner_id?: string
          payload?: Json | null
          read_at?: string | null
          resolved_at?: string | null
          seen_at?: string | null
          sent_at?: string | null
          severity?: string
          snoozed_until?: string | null
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
            foreignKeyName: "alert_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      alert_preferences: {
        Row: {
          created_at: string | null
          id: string
          preferences: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          preferences?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          preferences?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
            foreignKeyName: "alert_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_read: boolean | null
          message: string
          organization_id: string | null
          owner_id: string
          severity: Database["public"]["Enums"]["alert_severity"]
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          organization_id?: string | null
          owner_id: string
          severity?: Database["public"]["Enums"]["alert_severity"]
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          organization_id?: string | null
          owner_id?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      atenia_ai_actions: {
        Row: {
          action_result: string | null
          action_taken: string | null
          action_type: string
          actor: string | null
          actor_user_id: string | null
          approved_at: string | null
          approved_by: string | null
          autonomy_tier: string
          conversation_id: string | null
          created_at: string | null
          evidence: Json | null
          expires_at: string | null
          id: string
          input_snapshot: Json | null
          is_reversible: boolean | null
          organization_id: string
          provider: string | null
          reason_code: string | null
          reasoning: string
          reversible: boolean | null
          revert_action_id: string | null
          scope: string | null
          status: string | null
          summary: string | null
          target_entity_id: string | null
          target_entity_type: string | null
          work_item_id: string | null
          workflow_type: string | null
        }
        Insert: {
          action_result?: string | null
          action_taken?: string | null
          action_type: string
          actor?: string | null
          actor_user_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          autonomy_tier: string
          conversation_id?: string | null
          created_at?: string | null
          evidence?: Json | null
          expires_at?: string | null
          id?: string
          input_snapshot?: Json | null
          is_reversible?: boolean | null
          organization_id: string
          provider?: string | null
          reason_code?: string | null
          reasoning: string
          reversible?: boolean | null
          revert_action_id?: string | null
          scope?: string | null
          status?: string | null
          summary?: string | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          work_item_id?: string | null
          workflow_type?: string | null
        }
        Update: {
          action_result?: string | null
          action_taken?: string | null
          action_type?: string
          actor?: string | null
          actor_user_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          autonomy_tier?: string
          conversation_id?: string | null
          created_at?: string | null
          evidence?: Json | null
          expires_at?: string | null
          id?: string
          input_snapshot?: Json | null
          is_reversible?: boolean | null
          organization_id?: string
          provider?: string | null
          reason_code?: string | null
          reasoning?: string
          reversible?: boolean | null
          revert_action_id?: string | null
          scope?: string | null
          status?: string | null
          summary?: string | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          work_item_id?: string | null
          workflow_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_actions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "atenia_ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_ai_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_ai_actions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_autonomy_policy: {
        Row: {
          allowed_actions: string[] | null
          budgets: Json | null
          cooldowns: Json | null
          created_at: string | null
          id: string
          is_enabled: boolean | null
          notification_email: string | null
          notify_on_critical: boolean | null
          require_confirmation_actions: string[] | null
          updated_at: string | null
        }
        Insert: {
          allowed_actions?: string[] | null
          budgets?: Json | null
          cooldowns?: Json | null
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          notification_email?: string | null
          notify_on_critical?: boolean | null
          require_confirmation_actions?: string[] | null
          updated_at?: string | null
        }
        Update: {
          allowed_actions?: string[] | null
          budgets?: Json | null
          cooldowns?: Json | null
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          notification_email?: string | null
          notify_on_critical?: boolean | null
          require_confirmation_actions?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      atenia_ai_config: {
        Row: {
          alert_ai_enrichment: boolean | null
          allow_fallback_on_empty: boolean | null
          auto_demonitor_after_404s: number | null
          auto_sync_cooldown_minutes: number
          autonomy_paused: boolean | null
          created_at: string | null
          email_alert_min_severity: string | null
          email_alerts_enabled: boolean | null
          gemini_enabled: boolean | null
          heartbeat_interval_minutes: number | null
          id: string
          last_auto_sync_at: string | null
          max_auto_syncs_per_heartbeat: number | null
          max_provider_attempts_per_run: number | null
          organization_id: string
          paused_until: string | null
          provider_error_rate_threshold: number | null
          provider_slow_threshold_ms: number | null
          stage_inference_mode: string | null
          updated_at: string | null
          use_orchestrator_sync: boolean | null
        }
        Insert: {
          alert_ai_enrichment?: boolean | null
          allow_fallback_on_empty?: boolean | null
          auto_demonitor_after_404s?: number | null
          auto_sync_cooldown_minutes?: number
          autonomy_paused?: boolean | null
          created_at?: string | null
          email_alert_min_severity?: string | null
          email_alerts_enabled?: boolean | null
          gemini_enabled?: boolean | null
          heartbeat_interval_minutes?: number | null
          id?: string
          last_auto_sync_at?: string | null
          max_auto_syncs_per_heartbeat?: number | null
          max_provider_attempts_per_run?: number | null
          organization_id: string
          paused_until?: string | null
          provider_error_rate_threshold?: number | null
          provider_slow_threshold_ms?: number | null
          stage_inference_mode?: string | null
          updated_at?: string | null
          use_orchestrator_sync?: boolean | null
        }
        Update: {
          alert_ai_enrichment?: boolean | null
          allow_fallback_on_empty?: boolean | null
          auto_demonitor_after_404s?: number | null
          auto_sync_cooldown_minutes?: number
          autonomy_paused?: boolean | null
          created_at?: string | null
          email_alert_min_severity?: string | null
          email_alerts_enabled?: boolean | null
          gemini_enabled?: boolean | null
          heartbeat_interval_minutes?: number | null
          id?: string
          last_auto_sync_at?: string | null
          max_auto_syncs_per_heartbeat?: number | null
          max_provider_attempts_per_run?: number | null
          organization_id?: string
          paused_until?: string | null
          provider_error_rate_threshold?: number | null
          provider_slow_threshold_ms?: number | null
          stage_inference_mode?: string | null
          updated_at?: string | null
          use_orchestrator_sync?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_conversations: {
        Row: {
          action_count: number | null
          auto_escalated_at: string | null
          channel: string
          created_at: string | null
          created_by_user_id: string | null
          first_remediation_at: string | null
          id: string
          last_activity_at: string | null
          message_count: number | null
          observation_count: number | null
          organization_id: string | null
          related_providers: string[] | null
          related_work_item_ids: string[] | null
          related_workflows: string[] | null
          remediation_disabled: boolean | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          scope: string
          severity: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          action_count?: number | null
          auto_escalated_at?: string | null
          channel?: string
          created_at?: string | null
          created_by_user_id?: string | null
          first_remediation_at?: string | null
          id?: string
          last_activity_at?: string | null
          message_count?: number | null
          observation_count?: number | null
          organization_id?: string | null
          related_providers?: string[] | null
          related_work_item_ids?: string[] | null
          related_workflows?: string[] | null
          remediation_disabled?: boolean | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          scope?: string
          severity?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          action_count?: number | null
          auto_escalated_at?: string | null
          channel?: string
          created_at?: string | null
          created_by_user_id?: string | null
          first_remediation_at?: string | null
          id?: string
          last_activity_at?: string | null
          message_count?: number | null
          observation_count?: number | null
          organization_id?: string | null
          related_providers?: string[] | null
          related_work_item_ids?: string[] | null
          related_workflows?: string[] | null
          remediation_disabled?: boolean | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          scope?: string
          severity?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      atenia_ai_exports: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          created_by_user_id: string
          format: string
          id: string
          token_estimate: number | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          created_by_user_id: string
          format: string
          id?: string
          token_estimate?: number | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          created_by_user_id?: string
          format?: string
          id?: string
          token_estimate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_exports_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "atenia_ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_observations: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          id: string
          kind: Database["public"]["Enums"]["observation_kind"]
          links: Json | null
          organization_id: string | null
          payload: Json | null
          severity: Database["public"]["Enums"]["observation_severity"]
          title: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["observation_kind"]
          links?: Json | null
          organization_id?: string | null
          payload?: Json | null
          severity?: Database["public"]["Enums"]["observation_severity"]
          title: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["observation_kind"]
          links?: Json | null
          organization_id?: string | null
          payload?: Json | null
          severity?: Database["public"]["Enums"]["observation_severity"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_observations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "atenia_ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_op_messages: {
        Row: {
          content_structured: Json | null
          content_text: string
          conversation_id: string
          created_at: string | null
          created_by_user_id: string | null
          id: string
          related_action_ids: string[] | null
          related_work_item_ids: string[] | null
          role: string
        }
        Insert: {
          content_structured?: Json | null
          content_text: string
          conversation_id: string
          created_at?: string | null
          created_by_user_id?: string | null
          id?: string
          related_action_ids?: string[] | null
          related_work_item_ids?: string[] | null
          role: string
        }
        Update: {
          content_structured?: Json | null
          content_text?: string
          conversation_id?: string
          created_at?: string | null
          created_by_user_id?: string | null
          id?: string
          related_action_ids?: string[] | null
          related_work_item_ids?: string[] | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_op_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "atenia_ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_remediation_queue: {
        Row: {
          action_type: string
          attempts: number
          created_at: string
          dedupe_key: string | null
          id: string
          last_error: string | null
          lease_heartbeat_at: string | null
          max_attempts: number
          organization_id: string | null
          payload: Json
          priority: number
          provider: string | null
          reason_code: string | null
          run_after: string
          status: string
          updated_at: string
          work_item_id: string | null
        }
        Insert: {
          action_type: string
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          lease_heartbeat_at?: string | null
          max_attempts?: number
          organization_id?: string | null
          payload?: Json
          priority?: number
          provider?: string | null
          reason_code?: string | null
          run_after?: string
          status?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Update: {
          action_type?: string
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          lease_heartbeat_at?: string | null
          max_attempts?: number
          organization_id?: string | null
          payload?: Json
          priority?: number
          provider?: string | null
          reason_code?: string | null
          run_after?: string
          status?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_remediation_queue_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_reports: {
        Row: {
          ai_diagnosis: string | null
          created_at: string | null
          diagnostics: Json | null
          id: string
          items_failed: number | null
          items_synced_ok: number | null
          items_synced_partial: number | null
          lexy_data_ready: boolean | null
          new_actuaciones_found: number | null
          new_publicaciones_found: number | null
          organization_id: string
          provider_status: Json | null
          remediation_actions: Json | null
          report_date: string
          report_type: string
          total_work_items: number | null
        }
        Insert: {
          ai_diagnosis?: string | null
          created_at?: string | null
          diagnostics?: Json | null
          id?: string
          items_failed?: number | null
          items_synced_ok?: number | null
          items_synced_partial?: number | null
          lexy_data_ready?: boolean | null
          new_actuaciones_found?: number | null
          new_publicaciones_found?: number | null
          organization_id: string
          provider_status?: Json | null
          remediation_actions?: Json | null
          report_date: string
          report_type?: string
          total_work_items?: number | null
        }
        Update: {
          ai_diagnosis?: string | null
          created_at?: string | null
          diagnostics?: Json | null
          id?: string
          items_failed?: number | null
          items_synced_ok?: number | null
          items_synced_partial?: number | null
          lexy_data_ready?: boolean | null
          new_actuaciones_found?: number | null
          new_publicaciones_found?: number | null
          organization_id?: string
          provider_status?: Json | null
          remediation_actions?: Json | null
          report_date?: string
          report_type?: string
          total_work_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_scheduled_tasks: {
        Row: {
          last_attempt_at: string | null
          last_error: Json | null
          last_success_at: string | null
          locked_until: string | null
          run_count: number
          status: string
          task_key: string
          task_name: string
        }
        Insert: {
          last_attempt_at?: string | null
          last_error?: Json | null
          last_success_at?: string | null
          locked_until?: string | null
          run_count?: number
          status?: string
          task_key: string
          task_name: string
        }
        Update: {
          last_attempt_at?: string | null
          last_error?: Json | null
          last_success_at?: string | null
          locked_until?: string | null
          run_count?: number
          status?: string
          task_key?: string
          task_name?: string
        }
        Relationships: []
      }
      atenia_ai_user_reports: {
        Row: {
          ai_diagnosis: string | null
          auto_diagnosis: Json | null
          created_at: string
          description: string
          id: string
          organization_id: string
          report_type: string
          reporter_user_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
          work_item_id: string | null
        }
        Insert: {
          ai_diagnosis?: string | null
          auto_diagnosis?: Json | null
          created_at?: string
          description: string
          id?: string
          organization_id: string
          report_type?: string
          reporter_user_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Update: {
          ai_diagnosis?: string | null
          auto_diagnosis?: Json | null
          created_at?: string
          description?: string
          id?: string
          organization_id?: string
          report_type?: string
          reporter_user_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_user_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_ai_user_reports_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_ai_work_item_state: {
        Row: {
          consecutive_not_found: number
          consecutive_other_errors: number
          consecutive_timeouts: number
          last_error_code: string | null
          last_observed_at: string
          last_provider: string | null
          last_success_at: string | null
          organization_id: string
          work_item_id: string
        }
        Insert: {
          consecutive_not_found?: number
          consecutive_other_errors?: number
          consecutive_timeouts?: number
          last_error_code?: string | null
          last_observed_at?: string
          last_provider?: string | null
          last_success_at?: string | null
          organization_id: string
          work_item_id: string
        }
        Update: {
          consecutive_not_found?: number
          consecutive_other_errors?: number
          consecutive_timeouts?: number
          last_error_code?: string | null
          last_observed_at?: string
          last_provider?: string | null
          last_success_at?: string | null
          organization_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_ai_work_item_state_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: true
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_assistant_actions: {
        Row: {
          action_type: string
          context_summary: string | null
          created_at: string
          id: string
          input: Json
          model_output: Json | null
          organization_id: string
          result: Json | null
          session_id: string
          status: string
          user_id: string
          work_item_id: string | null
        }
        Insert: {
          action_type: string
          context_summary?: string | null
          created_at?: string
          id?: string
          input?: Json
          model_output?: Json | null
          organization_id: string
          result?: Json | null
          session_id: string
          status?: string
          user_id: string
          work_item_id?: string | null
        }
        Update: {
          action_type?: string
          context_summary?: string | null
          created_at?: string
          id?: string
          input?: Json
          model_output?: Json | null
          organization_id?: string
          result?: Json | null
          session_id?: string
          status?: string
          user_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_assistant_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_assistant_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "atenia_assistant_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_assistant_actions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_assistant_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          meta: Json
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          meta?: Json
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_assistant_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "atenia_assistant_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_assistant_sessions: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          organization_id: string
          scope: string
          user_id: string
          work_item_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          organization_id: string
          scope: string
          user_id: string
          work_item_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          organization_id?: string
          scope?: string
          user_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "atenia_assistant_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_assistant_sessions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_cron_runs: {
        Row: {
          details: Json
          finished_at: string | null
          id: string
          job_name: string
          scheduled_for: string
          started_at: string
          status: string
        }
        Insert: {
          details?: Json
          finished_at?: string | null
          id?: string
          job_name: string
          scheduled_for: string
          started_at?: string
          status?: string
        }
        Update: {
          details?: Json
          finished_at?: string | null
          id?: string
          job_name?: string
          scheduled_for?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      atenia_daily_ops_reports: {
        Row: {
          created_at: string
          id: string
          raw_run_metadata_json: Json | null
          report_date: string
          run_id: string
          status: string
          summary_json: Json | null
          txt_content: string | null
          txt_sha256: string | null
          txt_storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          raw_run_metadata_json?: Json | null
          report_date: string
          run_id: string
          status?: string
          summary_json?: Json | null
          txt_content?: string | null
          txt_sha256?: string | null
          txt_storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          raw_run_metadata_json?: Json | null
          report_date?: string
          run_id?: string
          status?: string
          summary_json?: Json | null
          txt_content?: string | null
          txt_sha256?: string | null
          txt_storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      atenia_deep_dives: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          dedupe_key: string | null
          diagnosis: string
          duration_ms: number | null
          finished_at: string | null
          gemini_analysis: string | null
          id: string
          included_in_digest: boolean | null
          last_heartbeat_at: string | null
          max_runtime_ms: number | null
          organization_id: string
          radicado: string
          recommended_actions: Json | null
          remediation_action_id: string | null
          remediation_applied: boolean | null
          root_cause: string | null
          severity: string
          started_at: string
          status: string
          steps: Json
          trigger_criteria: string
          trigger_evidence: Json | null
          work_item_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          diagnosis?: string
          duration_ms?: number | null
          finished_at?: string | null
          gemini_analysis?: string | null
          id?: string
          included_in_digest?: boolean | null
          last_heartbeat_at?: string | null
          max_runtime_ms?: number | null
          organization_id: string
          radicado: string
          recommended_actions?: Json | null
          remediation_action_id?: string | null
          remediation_applied?: boolean | null
          root_cause?: string | null
          severity?: string
          started_at?: string
          status?: string
          steps?: Json
          trigger_criteria: string
          trigger_evidence?: Json | null
          work_item_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          diagnosis?: string
          duration_ms?: number | null
          finished_at?: string | null
          gemini_analysis?: string | null
          id?: string
          included_in_digest?: boolean | null
          last_heartbeat_at?: string | null
          max_runtime_ms?: number | null
          organization_id?: string
          radicado?: string
          recommended_actions?: Json | null
          remediation_action_id?: string | null
          remediation_applied?: boolean | null
          root_cause?: string | null
          severity?: string
          started_at?: string
          status?: string
          steps?: Json
          trigger_criteria?: string
          trigger_evidence?: Json | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_deep_dives_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_deep_dives_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_e2e_test_registry: {
        Row: {
          consecutive_failures: number | null
          created_at: string | null
          expected_source_count: Json | null
          id: string
          is_sentinel: boolean | null
          last_test_result: string | null
          last_tested_at: string | null
          organization_id: string
          providers_to_test: string[]
          radicado: string
          work_item_id: string
          workflow_type: string
        }
        Insert: {
          consecutive_failures?: number | null
          created_at?: string | null
          expected_source_count?: Json | null
          id?: string
          is_sentinel?: boolean | null
          last_test_result?: string | null
          last_tested_at?: string | null
          organization_id: string
          providers_to_test: string[]
          radicado: string
          work_item_id: string
          workflow_type: string
        }
        Update: {
          consecutive_failures?: number | null
          created_at?: string | null
          expected_source_count?: Json | null
          id?: string
          is_sentinel?: boolean | null
          last_test_result?: string | null
          last_tested_at?: string | null
          organization_id?: string
          providers_to_test?: string[]
          radicado?: string
          work_item_id?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_e2e_test_registry_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_e2e_test_registry_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_e2e_test_results: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          fail_reason: string | null
          failure_stage: string | null
          failure_summary: string | null
          finished_at: string | null
          id: string
          organization_id: string
          overall: string
          radicado: string
          registry_id: string | null
          started_at: string
          steps: Json
          trigger: string
          work_item_id: string
          workflow_type: string
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          fail_reason?: string | null
          failure_stage?: string | null
          failure_summary?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          overall: string
          radicado: string
          registry_id?: string | null
          started_at?: string
          steps?: Json
          trigger: string
          work_item_id: string
          workflow_type: string
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          fail_reason?: string | null
          failure_stage?: string | null
          failure_summary?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          overall?: string
          radicado?: string
          registry_id?: string | null
          started_at?: string
          steps?: Json
          trigger?: string
          work_item_id?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_e2e_test_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_e2e_test_results_registry_id_fkey"
            columns: ["registry_id"]
            isOneToOne: false
            referencedRelation: "atenia_e2e_test_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "atenia_e2e_test_results_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      atenia_preflight_checks: {
        Row: {
          consecutive_failures_by_provider: Json | null
          created_at: string | null
          decision: string | null
          duration_ms: number | null
          finished_at: string | null
          id: string
          organization_id: string | null
          overall_status: string
          providers_failed: number | null
          providers_passed: number | null
          providers_tested: number | null
          results: Json
          started_at: string
          trigger: string
        }
        Insert: {
          consecutive_failures_by_provider?: Json | null
          created_at?: string | null
          decision?: string | null
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          organization_id?: string | null
          overall_status?: string
          providers_failed?: number | null
          providers_passed?: number | null
          providers_tested?: number | null
          results?: Json
          started_at?: string
          trigger: string
        }
        Update: {
          consecutive_failures_by_provider?: Json | null
          created_at?: string | null
          decision?: string | null
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          organization_id?: string | null
          overall_status?: string
          providers_failed?: number | null
          providers_passed?: number | null
          providers_tested?: number | null
          results?: Json
          started_at?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "atenia_preflight_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_provider_settings: {
        Row: {
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          notes: string | null
          provider_key: string
          required_secret_keys: string[]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          notes?: string | null
          provider_key: string
          required_secret_keys?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          notes?: string | null
          provider_key?: string
          required_secret_keys?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      auto_sync_daily_ledger: {
        Row: {
          chain_id: string | null
          completed_at: string | null
          continuation_block_reason: string | null
          continuation_enqueued: boolean | null
          continuation_of: string | null
          created_at: string
          cursor_last_work_item_id: string | null
          dead_letter_count: number | null
          error_summary: Json | null
          expected_total_items: number | null
          failure_reason: string | null
          finished_at: string | null
          id: string
          is_continuation: boolean | null
          items_failed: number | null
          items_skipped: number | null
          items_succeeded: number | null
          items_targeted: number | null
          last_error: string | null
          last_heartbeat_at: string | null
          manual_initiator_user_id: string | null
          metadata: Json | null
          organization_id: string
          retry_count: number | null
          run_cutoff_time: string | null
          run_date: string
          run_id: string | null
          scheduled_for: string
          started_at: string | null
          status: Database["public"]["Enums"]["daily_sync_status"]
          timeout_count: number | null
          trigger_source: string
          updated_at: string
        }
        Insert: {
          chain_id?: string | null
          completed_at?: string | null
          continuation_block_reason?: string | null
          continuation_enqueued?: boolean | null
          continuation_of?: string | null
          created_at?: string
          cursor_last_work_item_id?: string | null
          dead_letter_count?: number | null
          error_summary?: Json | null
          expected_total_items?: number | null
          failure_reason?: string | null
          finished_at?: string | null
          id?: string
          is_continuation?: boolean | null
          items_failed?: number | null
          items_skipped?: number | null
          items_succeeded?: number | null
          items_targeted?: number | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          manual_initiator_user_id?: string | null
          metadata?: Json | null
          organization_id: string
          retry_count?: number | null
          run_cutoff_time?: string | null
          run_date: string
          run_id?: string | null
          scheduled_for: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["daily_sync_status"]
          timeout_count?: number | null
          trigger_source?: string
          updated_at?: string
        }
        Update: {
          chain_id?: string | null
          completed_at?: string | null
          continuation_block_reason?: string | null
          continuation_enqueued?: boolean | null
          continuation_of?: string | null
          created_at?: string
          cursor_last_work_item_id?: string | null
          dead_letter_count?: number | null
          error_summary?: Json | null
          expected_total_items?: number | null
          failure_reason?: string | null
          finished_at?: string | null
          id?: string
          is_continuation?: boolean | null
          items_failed?: number | null
          items_skipped?: number | null
          items_succeeded?: number | null
          items_targeted?: number | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          manual_initiator_user_id?: string | null
          metadata?: Json | null
          organization_id?: string
          retry_count?: number | null
          run_cutoff_time?: string | null
          run_date?: string
          run_id?: string | null
          scheduled_for?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["daily_sync_status"]
          timeout_count?: number | null
          trigger_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_sync_daily_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_sync_login_runs: {
        Row: {
          created_at: string
          id: string
          last_run_at: string | null
          organization_id: string
          run_count: number
          run_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_run_at?: string | null
          organization_id: string
          run_count?: number
          run_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_run_at?: string | null
          organization_id?: string
          run_count?: number
          run_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_sync_login_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_checkout_sessions: {
        Row: {
          amount_breakdown: Json | null
          amount_cop_incl_iva: number | null
          billing_cycle_months: number
          checkout_url: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          discount_amount_cop: number | null
          discount_code_id: string | null
          id: string
          metadata: Json
          organization_id: string
          price_point_id: string | null
          provider: string
          provider_session_id: string | null
          status: string
          tier: string
        }
        Insert: {
          amount_breakdown?: Json | null
          amount_cop_incl_iva?: number | null
          billing_cycle_months?: number
          checkout_url?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount_cop?: number | null
          discount_code_id?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          price_point_id?: string | null
          provider?: string
          provider_session_id?: string | null
          status?: string
          tier: string
        }
        Update: {
          amount_breakdown?: Json | null
          amount_cop_incl_iva?: number | null
          billing_cycle_months?: number
          checkout_url?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount_cop?: number | null
          discount_code_id?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          price_point_id?: string | null
          provider?: string
          provider_session_id?: string | null
          status?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_checkout_sessions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "billing_discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_checkout_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_checkout_sessions_price_point_id_fkey"
            columns: ["price_point_id"]
            isOneToOne: false
            referencedRelation: "billing_price_points"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_customers: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          provider: string
          provider_customer_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          provider?: string
          provider_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          provider?: string
          provider_customer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_discount_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          current_redemptions: number
          discount_type: string
          discount_value: number
          eligible_cycles: number[] | null
          eligible_plans: string[] | null
          id: string
          is_active: boolean
          max_redemptions: number | null
          notes: string | null
          target_org_id: string | null
          target_user_email: string | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          current_redemptions?: number
          discount_type: string
          discount_value: number
          eligible_cycles?: number[] | null
          eligible_plans?: string[] | null
          id?: string
          is_active?: boolean
          max_redemptions?: number | null
          notes?: string | null
          target_org_id?: string | null
          target_user_email?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          current_redemptions?: number
          discount_type?: string
          discount_value?: number
          eligible_cycles?: number[] | null
          eligible_plans?: string[] | null
          id?: string
          is_active?: boolean
          max_redemptions?: number | null
          notes?: string | null
          target_org_id?: string | null
          target_user_email?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_discount_codes_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_discount_redemptions: {
        Row: {
          billing_cycle_months: number
          checkout_session_id: string | null
          created_at: string
          discount_amount_cop: number
          discount_code_id: string
          final_amount_cop: number
          id: string
          ip_hash: string | null
          organization_id: string
          original_amount_cop: number
          plan_code: string
          user_id: string | null
        }
        Insert: {
          billing_cycle_months?: number
          checkout_session_id?: string | null
          created_at?: string
          discount_amount_cop: number
          discount_code_id: string
          final_amount_cop: number
          id?: string
          ip_hash?: string | null
          organization_id: string
          original_amount_cop: number
          plan_code: string
          user_id?: string | null
        }
        Update: {
          billing_cycle_months?: number
          checkout_session_id?: string | null
          created_at?: string
          discount_amount_cop?: number
          discount_code_id?: string
          final_amount_cop?: number
          id?: string
          ip_hash?: string | null
          organization_id?: string
          original_amount_cop?: number
          plan_code?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_discount_redemptions_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "billing_checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_discount_redemptions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "billing_discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_discount_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_invoices: {
        Row: {
          amount_cop_incl_iva: number | null
          amount_usd: number | null
          created_at: string
          currency: string
          discount_amount_cop: number | null
          discount_code_id: string | null
          hosted_invoice_url: string | null
          id: string
          metadata: Json
          organization_id: string
          period_end: string | null
          period_start: string | null
          price_point_id: string | null
          provider: string
          provider_invoice_id: string | null
          status: string
        }
        Insert: {
          amount_cop_incl_iva?: number | null
          amount_usd?: number | null
          created_at?: string
          currency?: string
          discount_amount_cop?: number | null
          discount_code_id?: string | null
          hosted_invoice_url?: string | null
          id?: string
          metadata?: Json
          organization_id: string
          period_end?: string | null
          period_start?: string | null
          price_point_id?: string | null
          provider?: string
          provider_invoice_id?: string | null
          status?: string
        }
        Update: {
          amount_cop_incl_iva?: number | null
          amount_usd?: number | null
          created_at?: string
          currency?: string
          discount_amount_cop?: number | null
          discount_code_id?: string | null
          hosted_invoice_url?: string | null
          id?: string
          metadata?: Json
          organization_id?: string
          period_end?: string | null
          period_start?: string | null
          price_point_id?: string | null
          provider?: string
          provider_invoice_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_invoices_price_point_id_fkey"
            columns: ["price_point_id"]
            isOneToOne: false
            referencedRelation: "billing_price_points"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          code: string
          created_at: string
          display_name: string
          id: string
          is_enterprise: boolean
          max_members: number
        }
        Insert: {
          code: string
          created_at?: string
          display_name: string
          id?: string
          is_enterprise?: boolean
          max_members?: number
        }
        Update: {
          code?: string
          created_at?: string
          display_name?: string
          id?: string
          is_enterprise?: boolean
          max_members?: number
        }
        Relationships: []
      }
      billing_price_points: {
        Row: {
          billing_cycle_months: number
          created_at: string
          currency: string
          id: string
          is_active: boolean
          plan_id: string
          price_cop_incl_iva: number
          price_lock_months: number
          price_type: string
          promo_requires_commit_24m: boolean
          valid_from: string
          valid_to: string | null
          version_number: number
        }
        Insert: {
          billing_cycle_months: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          plan_id: string
          price_cop_incl_iva: number
          price_lock_months?: number
          price_type: string
          promo_requires_commit_24m?: boolean
          valid_from: string
          valid_to?: string | null
          version_number?: number
        }
        Update: {
          billing_cycle_months?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          plan_id?: string
          price_cop_incl_iva?: number
          price_lock_months?: number
          price_type?: string
          promo_requires_commit_24m?: boolean
          valid_from?: string
          valid_to?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_price_points_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_price_schedules: {
        Row: {
          applied: boolean
          applied_at: string | null
          applied_by: string | null
          billing_cycle_months: number
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          effective_at: string
          id: string
          new_price_cop_incl_iva: number
          notes: string | null
          plan_id: string
          price_type: string
          reason: string | null
          scope: string
          status: string
        }
        Insert: {
          applied?: boolean
          applied_at?: string | null
          applied_by?: string | null
          billing_cycle_months?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          effective_at: string
          id?: string
          new_price_cop_incl_iva: number
          notes?: string | null
          plan_id: string
          price_type?: string
          reason?: string | null
          scope?: string
          status?: string
        }
        Update: {
          applied?: boolean
          applied_at?: string | null
          applied_by?: string | null
          billing_cycle_months?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          effective_at?: string
          id?: string
          new_price_cop_incl_iva?: number
          notes?: string | null
          plan_id?: string
          price_type?: string
          reason?: string | null
          scope?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_price_schedules_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_subscription_state: {
        Row: {
          billing_cycle_months: number
          cancellation_reason: string | null
          cancelled_at: string | null
          comped_reason: string | null
          comped_until_at: string | null
          comped_voucher_id: string | null
          consecutive_payment_failures: number | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          current_price_cop_incl_iva: number
          gateway_customer_id: string | null
          gateway_subscription_id: string | null
          grace_period_end: string | null
          intro_offer_applied: boolean
          last_payment_id: string | null
          next_billing_at: string | null
          organization_id: string
          plan_code: string
          price_lock_end_at: string | null
          status: string | null
          suspended_at: string | null
          trial_end_at: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle_months?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          comped_reason?: string | null
          comped_until_at?: string | null
          comped_voucher_id?: string | null
          consecutive_payment_failures?: number | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          current_price_cop_incl_iva?: number
          gateway_customer_id?: string | null
          gateway_subscription_id?: string | null
          grace_period_end?: string | null
          intro_offer_applied?: boolean
          last_payment_id?: string | null
          next_billing_at?: string | null
          organization_id: string
          plan_code: string
          price_lock_end_at?: string | null
          status?: string | null
          suspended_at?: string | null
          trial_end_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle_months?: number
          cancellation_reason?: string | null
          cancelled_at?: string | null
          comped_reason?: string | null
          comped_until_at?: string | null
          comped_voucher_id?: string | null
          consecutive_payment_failures?: number | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          current_price_cop_incl_iva?: number
          gateway_customer_id?: string | null
          gateway_subscription_id?: string | null
          grace_period_end?: string | null
          intro_offer_applied?: boolean
          last_payment_id?: string | null
          next_billing_at?: string | null
          organization_id?: string
          plan_code?: string
          price_lock_end_at?: string | null
          status?: string | null
          suspended_at?: string | null
          trial_end_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscription_state_comped_voucher_id_fkey"
            columns: ["comped_voucher_id"]
            isOneToOne: false
            referencedRelation: "platform_vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscription_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_webhook_receipts: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string | null
          gateway: string
          gateway_event_id: string | null
          gateway_transaction_id: string | null
          http_status_returned: number | null
          id: string
          latency_ms: number | null
          outcome: string | null
          raw_payload: Json
          retry_number: number | null
          signature_raw: string | null
          signature_valid: boolean | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          gateway?: string
          gateway_event_id?: string | null
          gateway_transaction_id?: string | null
          http_status_returned?: number | null
          id?: string
          latency_ms?: number | null
          outcome?: string | null
          raw_payload?: Json
          retry_number?: number | null
          signature_raw?: string | null
          signature_valid?: boolean | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          gateway?: string
          gateway_event_id?: string | null
          gateway_transaction_id?: string | null
          http_status_returned?: number | null
          id?: string
          latency_ms?: number | null
          outcome?: string | null
          raw_payload?: Json
          retry_number?: number | null
          signature_raw?: string | null
          signature_valid?: boolean | null
        }
        Relationships: []
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
          has_favorable_sentencia: boolean
          id: string
          inactivity_threshold_months: number
          is_at_risk: boolean
          last_activity_date: string
          last_activity_description: string | null
          last_activity_milestone_id: string | null
          owner_id: string
          risk_since: string | null
          updated_at: string
          work_item_id: string | null
        }
        Insert: {
          created_at?: string
          has_favorable_sentencia?: boolean
          id?: string
          inactivity_threshold_months?: number
          is_at_risk?: boolean
          last_activity_date: string
          last_activity_description?: string | null
          last_activity_milestone_id?: string | null
          owner_id: string
          risk_since?: string | null
          updated_at?: string
          work_item_id?: string | null
        }
        Update: {
          created_at?: string
          has_favorable_sentencia?: boolean
          id?: string
          inactivity_threshold_months?: number
          is_at_risk?: boolean
          last_activity_date?: string
          last_activity_description?: string | null
          last_activity_milestone_id?: string | null
          owner_id?: string
          risk_since?: string | null
          updated_at?: string
          work_item_id?: string | null
        }
        Relationships: [
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
            foreignKeyName: "cgp_inactivity_tracker_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
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
          source: Database["public"]["Enums"]["milestone_source"] | null
          source_actuacion_id: string | null
          updated_at: string
          user_confirmed_at: string | null
          user_rejected_at: string | null
          work_item_id: string | null
        }
        Insert: {
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          custom_type_name?: string | null
          event_date?: string | null
          event_time?: string | null
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
          source?: Database["public"]["Enums"]["milestone_source"] | null
          source_actuacion_id?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_rejected_at?: string | null
          work_item_id?: string | null
        }
        Update: {
          attachments?: Json | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          custom_type_name?: string | null
          event_date?: string | null
          event_time?: string | null
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
          source?: Database["public"]["Enums"]["milestone_source"] | null
          source_actuacion_id?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_rejected_at?: string | null
          work_item_id?: string | null
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
            foreignKeyName: "cgp_milestones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_milestones_source_actuacion_id_fkey"
            columns: ["source_actuacion_id"]
            isOneToOne: false
            referencedRelation: "actuaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cgp_milestones_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cgp_term_instances: {
        Row: {
          computed_with_suspensions: boolean
          created_at: string
          due_date: string
          id: string
          in_audience: boolean
          last_computed_at: string
          original_due_date: string
          owner_id: string
          pause_reason: string | null
          paused_at: string | null
          paused_days_accumulated: number | null
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
          work_item_id: string | null
        }
        Insert: {
          computed_with_suspensions?: boolean
          created_at?: string
          due_date: string
          id?: string
          in_audience?: boolean
          last_computed_at?: string
          original_due_date: string
          owner_id: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_days_accumulated?: number | null
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
          work_item_id?: string | null
        }
        Update: {
          computed_with_suspensions?: boolean
          created_at?: string
          due_date?: string
          id?: string
          in_audience?: boolean
          last_computed_at?: string
          original_due_date?: string
          owner_id?: string
          pause_reason?: string | null
          paused_at?: string | null
          paused_days_accumulated?: number | null
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
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cgp_term_instances_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          {
            foreignKeyName: "cgp_term_instances_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
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
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          email_linking_enabled: boolean | null
          id: string
          id_number: string | null
          name: string
          notes: string | null
          organization_id: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          email_linking_enabled?: boolean | null
          id?: string
          id_number?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          email_linking_enabled?: boolean | null
          id?: string
          id_number?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      control_radicados: {
        Row: {
          category: string
          city: string | null
          created_at: string
          created_by: string | null
          dane_code: string | null
          id: string
          is_active: boolean
          jurisdiction_hint: string | null
          last_verified_at: string | null
          last_verified_status: string | null
          notes: string | null
          radicado: string
          updated_at: string
        }
        Insert: {
          category: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          dane_code?: string | null
          id?: string
          is_active?: boolean
          jurisdiction_hint?: string | null
          last_verified_at?: string | null
          last_verified_status?: string | null
          notes?: string | null
          radicado: string
          updated_at?: string
        }
        Update: {
          category?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          dane_code?: string | null
          id?: string
          is_active?: boolean
          jurisdiction_hint?: string | null
          last_verified_at?: string | null
          last_verified_status?: string | null
          notes?: string | null
          radicado?: string
          updated_at?: string
        }
        Relationships: []
      }
      court_emails: {
        Row: {
          contributed_by: string | null
          court_city: string | null
          court_code: string | null
          court_email: string | null
          court_name: string
          court_type: string | null
          created_at: string | null
          department: string | null
          id: string
          judge_name: string | null
          source: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          contributed_by?: string | null
          court_city?: string | null
          court_code?: string | null
          court_email?: string | null
          court_name: string
          court_type?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          judge_name?: string | null
          source?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          contributed_by?: string | null
          court_city?: string | null
          court_code?: string | null
          court_email?: string | null
          court_name?: string
          court_type?: string | null
          created_at?: string | null
          department?: string | null
          id?: string
          judge_name?: string | null
          source?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      courthouse_directory: {
        Row: {
          account_type_norm: string
          canonical_key: string
          chamber_norm: string | null
          city_norm: string
          ciudad_raw: string | null
          codigo_despacho_norm: string | null
          codigo_despacho_raw: string | null
          corp_area_norm: string
          corp_code: string | null
          corporacion_area_raw: string | null
          court_class: string
          court_number: number | null
          court_number_padded: string | null
          dane_code: string | null
          departamento_raw: string | null
          dept_norm: string
          desp_code: string | null
          email: string
          esp_code: string | null
          especialidad_area_raw: string | null
          id: number
          imported_at: string
          level_norm: string | null
          name_norm_hard: string
          name_norm_soft: string
          nombre_raw: string
          source_name: string
          source_row_hash: string
          specialty_norm: string
          tipo_cuenta_raw: string | null
        }
        Insert: {
          account_type_norm?: string
          canonical_key?: string
          chamber_norm?: string | null
          city_norm?: string
          ciudad_raw?: string | null
          codigo_despacho_norm?: string | null
          codigo_despacho_raw?: string | null
          corp_area_norm?: string
          corp_code?: string | null
          corporacion_area_raw?: string | null
          court_class?: string
          court_number?: number | null
          court_number_padded?: string | null
          dane_code?: string | null
          departamento_raw?: string | null
          dept_norm?: string
          desp_code?: string | null
          email: string
          esp_code?: string | null
          especialidad_area_raw?: string | null
          id?: number
          imported_at?: string
          level_norm?: string | null
          name_norm_hard?: string
          name_norm_soft?: string
          nombre_raw: string
          source_name?: string
          source_row_hash: string
          specialty_norm?: string
          tipo_cuenta_raw?: string | null
        }
        Update: {
          account_type_norm?: string
          canonical_key?: string
          chamber_norm?: string | null
          city_norm?: string
          ciudad_raw?: string | null
          codigo_despacho_norm?: string | null
          codigo_despacho_raw?: string | null
          corp_area_norm?: string
          corp_code?: string | null
          corporacion_area_raw?: string | null
          court_class?: string
          court_number?: number | null
          court_number_padded?: string | null
          dane_code?: string | null
          departamento_raw?: string | null
          dept_norm?: string
          desp_code?: string | null
          email?: string
          esp_code?: string | null
          especialidad_area_raw?: string | null
          id?: number
          imported_at?: string
          level_norm?: string | null
          name_norm_hard?: string
          name_norm_soft?: string
          nombre_raw?: string
          source_name?: string
          source_row_hash?: string
          specialty_norm?: string
          tipo_cuenta_raw?: string | null
        }
        Relationships: []
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
            foreignKeyName: "cpaca_processes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      cron_state: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      daily_welcome_log: {
        Row: {
          activity_count: number | null
          ai_model_used: string | null
          created_at: string
          event_date: string
          event_type: string
          id: string
          latency_ms: number | null
          metadata: Json | null
          organization_id: string | null
          user_id: string
        }
        Insert: {
          activity_count?: number | null
          ai_model_used?: string | null
          created_at?: string
          event_date: string
          event_type: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          organization_id?: string | null
          user_id: string
        }
        Update: {
          activity_count?: number | null
          ai_model_used?: string | null
          created_at?: string
          event_date?: string
          event_type?: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          organization_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_welcome_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      danger_zone_unlocks: {
        Row: {
          created_at: string
          expires_at: string
          granted_by: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          granted_by?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          granted_by?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      data_access_log: {
        Row: {
          accessed_at: string
          columns_accessed: string[] | null
          context: string | null
          id: string
          ip_address: string | null
          operation: string
          organization_id: string | null
          row_count: number | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          accessed_at?: string
          columns_accessed?: string[] | null
          context?: string | null
          id?: string
          ip_address?: string | null
          operation: string
          organization_id?: string | null
          row_count?: number | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          accessed_at?: string
          columns_accessed?: string[] | null
          context?: string | null
          id?: string
          ip_address?: string | null
          operation?: string
          organization_id?: string | null
          row_count?: number | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      demo_events: {
        Row: {
          category_inferred: string | null
          confidence: string | null
          conflicts_count: number | null
          created_at: string
          cta_type: string | null
          event_name: string
          frame: string | null
          has_actuaciones: boolean | null
          has_estados: boolean | null
          id: string
          ip_hash: string | null
          latency_ms: number | null
          outcome: string | null
          payload: Json | null
          providers_checked: number | null
          providers_with_data: number | null
          radicado_hash: string | null
          radicado_length: number | null
          referrer_domain: string | null
          route: string | null
          session_id: string | null
          user_agent_bucket: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          variant: string | null
        }
        Insert: {
          category_inferred?: string | null
          confidence?: string | null
          conflicts_count?: number | null
          created_at?: string
          cta_type?: string | null
          event_name: string
          frame?: string | null
          has_actuaciones?: boolean | null
          has_estados?: boolean | null
          id?: string
          ip_hash?: string | null
          latency_ms?: number | null
          outcome?: string | null
          payload?: Json | null
          providers_checked?: number | null
          providers_with_data?: number | null
          radicado_hash?: string | null
          radicado_length?: number | null
          referrer_domain?: string | null
          route?: string | null
          session_id?: string | null
          user_agent_bucket?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          variant?: string | null
        }
        Update: {
          category_inferred?: string | null
          confidence?: string | null
          conflicts_count?: number | null
          created_at?: string
          cta_type?: string | null
          event_name?: string
          frame?: string | null
          has_actuaciones?: boolean | null
          has_estados?: boolean | null
          id?: string
          ip_hash?: string | null
          latency_ms?: number | null
          outcome?: string | null
          payload?: Json | null
          providers_checked?: number | null
          providers_with_data?: number | null
          radicado_hash?: string | null
          radicado_length?: number | null
          referrer_domain?: string | null
          route?: string | null
          session_id?: string | null
          user_agent_bucket?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      demo_radicado_cache: {
        Row: {
          actuaciones: Json | null
          cache_ttl_hours: number | null
          content_hash: string | null
          created_at: string | null
          estados: Json | null
          id: string
          inferred_category: string | null
          last_refresh_at: string
          partes: Json | null
          proceso: Json | null
          provider_results: Json | null
          providers_consulted: number | null
          providers_succeeded: number | null
          radicado: string
          radicado_normalized: string
          tutela_detail: Json | null
          updated_at: string | null
        }
        Insert: {
          actuaciones?: Json | null
          cache_ttl_hours?: number | null
          content_hash?: string | null
          created_at?: string | null
          estados?: Json | null
          id?: string
          inferred_category?: string | null
          last_refresh_at?: string
          partes?: Json | null
          proceso?: Json | null
          provider_results?: Json | null
          providers_consulted?: number | null
          providers_succeeded?: number | null
          radicado: string
          radicado_normalized: string
          tutela_detail?: Json | null
          updated_at?: string | null
        }
        Update: {
          actuaciones?: Json | null
          cache_ttl_hours?: number | null
          content_hash?: string | null
          created_at?: string | null
          estados?: Json | null
          id?: string
          inferred_category?: string | null
          last_refresh_at?: string
          partes?: Json | null
          proceso?: Json | null
          provider_results?: Json | null
          providers_consulted?: number | null
          providers_succeeded?: number | null
          radicado?: string
          radicado_normalized?: string
          tutela_detail?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      demo_rate_limit_counters: {
        Row: {
          count: number
          id: string
          key: string
          updated_at: string
          window_start: string
          window_type: string
        }
        Insert: {
          count?: number
          id?: string
          key: string
          updated_at?: string
          window_start: string
          window_type: string
        }
        Update: {
          count?: number
          id?: string
          key?: string
          updated_at?: string
          window_start?: string
          window_type?: string
        }
        Relationships: []
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
        ]
      }
      document_evidence_proofs: {
        Row: {
          created_at: string
          document_id: string
          file_name: string
          file_path: string
          file_sha256: string
          file_size_bytes: number | null
          id: string
          label: string
          metadata: Json | null
          mime_type: string | null
          organization_id: string
          proof_type: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          document_id: string
          file_name: string
          file_path: string
          file_sha256: string
          file_size_bytes?: number | null
          id?: string
          label: string
          metadata?: Json | null
          mime_type?: string | null
          organization_id: string
          proof_type?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          document_id?: string
          file_name?: string
          file_path?: string
          file_sha256?: string
          file_size_bytes?: number | null
          id?: string
          label?: string
          metadata?: Json | null
          mime_type?: string | null
          organization_id?: string
          proof_type?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_evidence_proofs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_evidence_proofs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_retention_policies: {
        Row: {
          created_at: string
          document_type: string
          id: string
          organization_id: string
          retention_years: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type: string
          id?: string
          organization_id: string
          retention_years?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          id?: string
          organization_id?: string
          retention_years?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_signature_events: {
        Row: {
          actor_id: string | null
          actor_ip: string | null
          actor_type: string
          actor_user_agent: string | null
          created_at: string
          device_fingerprint_hash: string | null
          document_id: string | null
          event_data: Json
          event_hash: string | null
          event_type: string
          id: string
          organization_id: string
          previous_event_hash: string | null
          signature_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_ip?: string | null
          actor_type: string
          actor_user_agent?: string | null
          created_at?: string
          device_fingerprint_hash?: string | null
          document_id?: string | null
          event_data?: Json
          event_hash?: string | null
          event_type: string
          id?: string
          organization_id: string
          previous_event_hash?: string | null
          signature_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_ip?: string | null
          actor_type?: string
          actor_user_agent?: string | null
          created_at?: string
          device_fingerprint_hash?: string | null
          document_id?: string | null
          event_data?: Json
          event_hash?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          previous_event_hash?: string | null
          signature_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_signature_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signature_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signature_events_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "document_signatures"
            referencedColumns: ["id"]
          },
        ]
      }
      document_signatures: {
        Row: {
          certificate_id: string | null
          certificate_path: string | null
          combined_pdf_hash: string | null
          consumed_at: string | null
          created_at: string | null
          created_by: string
          depends_on: string | null
          device_fingerprint_hash: string | null
          document_id: string
          expires_at: string
          hmac_signature: string
          id: string
          identity_confirmation_data: Json | null
          identity_confirmed_at: string | null
          organization_id: string
          otp_attempts: number | null
          otp_code_hash: string | null
          otp_sent_at: string | null
          otp_verified_at: string | null
          signature_data: string | null
          signature_image_path: string | null
          signature_method: string | null
          signature_stroke_data: Json | null
          signed_at: string | null
          signed_document_hash: string | null
          signed_document_path: string | null
          signer_cedula: string | null
          signer_email: string
          signer_geolocation: Json | null
          signer_ip: string | null
          signer_name: string
          signer_phone: string | null
          signer_role: string
          signer_user_agent: string | null
          signing_order: number | null
          signing_token: string
          status: string
          updated_at: string | null
        }
        Insert: {
          certificate_id?: string | null
          certificate_path?: string | null
          combined_pdf_hash?: string | null
          consumed_at?: string | null
          created_at?: string | null
          created_by: string
          depends_on?: string | null
          device_fingerprint_hash?: string | null
          document_id: string
          expires_at: string
          hmac_signature: string
          id?: string
          identity_confirmation_data?: Json | null
          identity_confirmed_at?: string | null
          organization_id: string
          otp_attempts?: number | null
          otp_code_hash?: string | null
          otp_sent_at?: string | null
          otp_verified_at?: string | null
          signature_data?: string | null
          signature_image_path?: string | null
          signature_method?: string | null
          signature_stroke_data?: Json | null
          signed_at?: string | null
          signed_document_hash?: string | null
          signed_document_path?: string | null
          signer_cedula?: string | null
          signer_email: string
          signer_geolocation?: Json | null
          signer_ip?: string | null
          signer_name: string
          signer_phone?: string | null
          signer_role?: string
          signer_user_agent?: string | null
          signing_order?: number | null
          signing_token: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          certificate_id?: string | null
          certificate_path?: string | null
          combined_pdf_hash?: string | null
          consumed_at?: string | null
          created_at?: string | null
          created_by?: string
          depends_on?: string | null
          device_fingerprint_hash?: string | null
          document_id?: string
          expires_at?: string
          hmac_signature?: string
          id?: string
          identity_confirmation_data?: Json | null
          identity_confirmed_at?: string | null
          organization_id?: string
          otp_attempts?: number | null
          otp_code_hash?: string | null
          otp_sent_at?: string | null
          otp_verified_at?: string | null
          signature_data?: string | null
          signature_image_path?: string | null
          signature_method?: string | null
          signature_stroke_data?: Json | null
          signed_at?: string | null
          signed_document_hash?: string | null
          signed_document_path?: string | null
          signer_cedula?: string | null
          signer_email?: string
          signer_geolocation?: Json | null
          signer_ip?: string | null
          signer_name?: string
          signer_phone?: string | null
          signer_role?: string
          signer_user_agent?: string | null
          signing_order?: number | null
          signing_token?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_signatures_depends_on_fkey"
            columns: ["depends_on"]
            isOneToOne: false
            referencedRelation: "document_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signatures_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_signatures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          base_template_id: string | null
          created_at: string | null
          created_by: string | null
          customized_by: string | null
          description: string | null
          display_name: string
          document_type: string
          id: string
          is_active: boolean | null
          is_system_template: boolean | null
          name: string
          organization_id: string | null
          template_body: Json
          template_html: string
          updated_at: string | null
          version: number | null
        }
        Insert: {
          base_template_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customized_by?: string | null
          description?: string | null
          display_name: string
          document_type: string
          id?: string
          is_active?: boolean | null
          is_system_template?: boolean | null
          name: string
          organization_id?: string | null
          template_body: Json
          template_html: string
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          base_template_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customized_by?: string | null
          description?: string | null
          display_name?: string
          document_type?: string
          id?: string
          is_active?: boolean | null
          is_system_template?: boolean | null
          name?: string
          organization_id?: string | null
          template_body?: Json
          template_html?: string
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_base_template_id_fkey"
            columns: ["base_template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            foreignKeyName: "documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dunning_rules: {
        Row: {
          action_type: string
          attempt_number: number
          created_at: string
          delay_hours: number
          escalation_action: string | null
          id: string
          notify_email: boolean
          notify_in_app: boolean
        }
        Insert: {
          action_type?: string
          attempt_number: number
          created_at?: string
          delay_hours?: number
          escalation_action?: string | null
          id?: string
          notify_email?: boolean
          notify_in_app?: boolean
        }
        Update: {
          action_type?: string
          attempt_number?: number
          created_at?: string
          delay_hours?: number
          escalation_action?: string | null
          id?: string
          notify_email?: boolean
          notify_in_app?: boolean
        }
        Relationships: []
      }
      dunning_schedule: {
        Row: {
          action_id: string | null
          action_type: string
          attempt_number: number
          created_at: string | null
          executed_at: string | null
          gateway_response: Json | null
          id: string
          organization_id: string
          result: string | null
          scheduled_at: string
          status: string
        }
        Insert: {
          action_id?: string | null
          action_type?: string
          attempt_number: number
          created_at?: string | null
          executed_at?: string | null
          gateway_response?: Json | null
          id?: string
          organization_id: string
          result?: string | null
          scheduled_at: string
          status?: string
        }
        Update: {
          action_id?: string | null
          action_type?: string
          attempt_number?: number
          created_at?: string | null
          executed_at?: string | null
          gateway_response?: Json | null
          id?: string
          organization_id?: string
          result?: string | null
          scheduled_at?: string
          status?: string
        }
        Relationships: []
      }
      email_delivery_events: {
        Row: {
          created_at: string
          email_outbox_id: string | null
          event_type: string
          id: string
          organization_id: string
          provider_event_id: string | null
          raw_payload: Json | null
        }
        Insert: {
          created_at?: string
          email_outbox_id?: string | null
          event_type: string
          id?: string
          organization_id: string
          provider_event_id?: string | null
          raw_payload?: Json | null
        }
        Update: {
          created_at?: string
          email_outbox_id?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          provider_event_id?: string | null
          raw_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_events_email_outbox_id_fkey"
            columns: ["email_outbox_id"]
            isOneToOne: false
            referencedRelation: "email_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          alert_instance_id: string | null
          attempts: number
          created_at: string
          dedupe_key: string | null
          error: string | null
          failed_permanent: boolean
          failure_type: string | null
          html: string
          id: string
          last_attempt_at: string | null
          last_event_at: string | null
          last_event_type: string | null
          metadata: Json | null
          next_attempt_at: string
          notification_rule_id: string | null
          organization_id: string
          provider_message_id: string | null
          sent_at: string | null
          status: string
          subject: string
          suppressed_reason: string | null
          template_id: string | null
          template_variables: Json | null
          to_email: string
          to_user_id: string | null
          trigger_event: string | null
          trigger_reason: string | null
          triggered_by: string | null
          work_item_id: string | null
        }
        Insert: {
          alert_instance_id?: string | null
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          failed_permanent?: boolean
          failure_type?: string | null
          html: string
          id?: string
          last_attempt_at?: string | null
          last_event_at?: string | null
          last_event_type?: string | null
          metadata?: Json | null
          next_attempt_at?: string
          notification_rule_id?: string | null
          organization_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          suppressed_reason?: string | null
          template_id?: string | null
          template_variables?: Json | null
          to_email: string
          to_user_id?: string | null
          trigger_event?: string | null
          trigger_reason?: string | null
          triggered_by?: string | null
          work_item_id?: string | null
        }
        Update: {
          alert_instance_id?: string | null
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          failed_permanent?: boolean
          failure_type?: string | null
          html?: string
          id?: string
          last_attempt_at?: string | null
          last_event_at?: string | null
          last_event_type?: string | null
          metadata?: Json | null
          next_attempt_at?: string
          notification_rule_id?: string | null
          organization_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          suppressed_reason?: string | null
          template_id?: string | null
          template_variables?: Json | null
          to_email?: string
          to_user_id?: string | null
          trigger_event?: string | null
          trigger_reason?: string | null
          triggered_by?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_alert_instance_id_fkey"
            columns: ["alert_instance_id"]
            isOneToOne: false
            referencedRelation: "alert_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_notification_rule_id_fkey"
            columns: ["notification_rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      email_provider_config: {
        Row: {
          config_key: string
          config_value: string
          environment: string
          id: string
          is_secret: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_key: string
          config_value: string
          environment?: string
          id?: string
          is_secret?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: string
          environment?: string
          id?: string
          is_secret?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          organization_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          organization_id: string
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            foreignKeyName: "email_threads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_verification_tokens: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          purpose: string
          subject_id: string | null
          subject_type: string
          token_hash: string
          used_at: string | null
          user_id: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          purpose?: string
          subject_id?: string | null
          subject_type?: string
          token_hash: string
          used_at?: string | null
          user_id: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          purpose?: string
          subject_id?: string | null
          subject_type?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
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
      estados_staleness_alerts: {
        Row: {
          alert_created_at: string
          created_at: string
          emails_sent_count: number | null
          id: string
          last_email_sent_at: string | null
          last_ingestion_at: string | null
          organization_id: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          alert_created_at?: string
          created_at?: string
          emails_sent_count?: number | null
          id?: string
          last_email_sent_at?: string | null
          last_ingestion_at?: string | null
          organization_id: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          alert_created_at?: string
          created_at?: string
          emails_sent_count?: number | null
          id?: string
          last_email_sent_at?: string | null
          last_ingestion_at?: string | null
          organization_id?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estados_staleness_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
      external_sync_run_attempts: {
        Row: {
          data_kind: string
          error_code: string | null
          error_message: string | null
          http_code: number | null
          id: string
          inserted_count: number
          latency_ms: number
          provider: string
          recorded_at: string
          role: string
          skipped_count: number
          status: string
          sync_run_id: string
        }
        Insert: {
          data_kind: string
          error_code?: string | null
          error_message?: string | null
          http_code?: number | null
          id?: string
          inserted_count?: number
          latency_ms?: number
          provider: string
          recorded_at?: string
          role: string
          skipped_count?: number
          status: string
          sync_run_id: string
        }
        Update: {
          data_kind?: string
          error_code?: string | null
          error_message?: string | null
          http_code?: number | null
          id?: string
          inserted_count?: number
          latency_ms?: number
          provider?: string
          recorded_at?: string
          role?: string
          skipped_count?: number
          status?: string
          sync_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_sync_run_attempts_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "external_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      external_sync_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          invoked_by: string
          organization_id: string | null
          provider_attempts: Json
          response_hash: string | null
          retry_count: number
          started_at: string
          status: string
          total_inserted_acts: number
          total_inserted_pubs: number
          total_skipped_acts: number
          total_skipped_pubs: number
          trigger_source: string | null
          work_item_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          invoked_by: string
          organization_id?: string | null
          provider_attempts?: Json
          response_hash?: string | null
          retry_count?: number
          started_at?: string
          status?: string
          total_inserted_acts?: number
          total_inserted_pubs?: number
          total_skipped_acts?: number
          total_skipped_pubs?: number
          trigger_source?: string | null
          work_item_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          invoked_by?: string
          organization_id?: string | null
          provider_attempts?: Json
          response_hash?: string | null
          retry_count?: number
          started_at?: string
          status?: string
          total_inserted_acts?: number
          total_inserted_pubs?: number
          total_skipped_acts?: number
          total_skipped_pubs?: number
          trigger_source?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_sync_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_sync_runs_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_call_log: {
        Row: {
          caller_type: string
          caller_user_id: string | null
          created_at: string
          duration_ms: number | null
          function_name: string
          id: string
          model: string
          organization_id: string | null
          status: string
          tokens_used: number | null
        }
        Insert: {
          caller_type: string
          caller_user_id?: string | null
          created_at?: string
          duration_ms?: number | null
          function_name: string
          id?: string
          model?: string
          organization_id?: string | null
          status?: string
          tokens_used?: number | null
        }
        Update: {
          caller_type?: string
          caller_user_id?: string | null
          created_at?: string
          duration_ms?: number | null
          function_name?: string
          id?: string
          model?: string
          organization_id?: string | null
          status?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gemini_call_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          content_html: string
          content_json: Json
          created_at: string | null
          created_by: string
          delete_blocked_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          document_hash_presign: string | null
          document_type: string
          entity_data: Json | null
          final_pdf_sha256: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          organization_id: string
          poderdante_type: string | null
          retention_expires_at: string | null
          retention_years: number | null
          status: string
          template_id: string | null
          title: string
          updated_at: string | null
          variables: Json
          work_item_id: string | null
        }
        Insert: {
          content_html: string
          content_json: Json
          created_at?: string | null
          created_by: string
          delete_blocked_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_hash_presign?: string | null
          document_type: string
          entity_data?: Json | null
          final_pdf_sha256?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          organization_id: string
          poderdante_type?: string | null
          retention_expires_at?: string | null
          retention_years?: number | null
          status?: string
          template_id?: string | null
          title: string
          updated_at?: string | null
          variables?: Json
          work_item_id?: string | null
        }
        Update: {
          content_html?: string
          content_json?: Json
          created_at?: string | null
          created_by?: string
          delete_blocked_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          document_hash_presign?: string | null
          document_type?: string
          entity_data?: Json | null
          final_pdf_sha256?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          organization_id?: string
          poderdante_type?: string | null
          retention_expires_at?: string | null
          retention_years?: number | null
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string | null
          variables?: Json
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ghost_verification_runs: {
        Row: {
          action_taken: string | null
          classification: string
          classification_reason: string | null
          completed_at: string | null
          consecutive_failures: number
          control_category: string | null
          control_providers_attempted: string[] | null
          control_providers_succeeded: string[] | null
          control_radicado: string | null
          control_radicado_id: string | null
          control_run_status: string | null
          control_trace_id: string | null
          created_at: string
          id: string
          incident_id: string | null
          organization_id: string
          recheck_providers_attempted: string[] | null
          recheck_providers_succeeded: string[] | null
          recheck_status: string | null
          recheck_trace_id: string | null
          started_at: string
          trigger_reason: string
          work_item_id: string
        }
        Insert: {
          action_taken?: string | null
          classification?: string
          classification_reason?: string | null
          completed_at?: string | null
          consecutive_failures?: number
          control_category?: string | null
          control_providers_attempted?: string[] | null
          control_providers_succeeded?: string[] | null
          control_radicado?: string | null
          control_radicado_id?: string | null
          control_run_status?: string | null
          control_trace_id?: string | null
          created_at?: string
          id?: string
          incident_id?: string | null
          organization_id: string
          recheck_providers_attempted?: string[] | null
          recheck_providers_succeeded?: string[] | null
          recheck_status?: string | null
          recheck_trace_id?: string | null
          started_at?: string
          trigger_reason: string
          work_item_id: string
        }
        Update: {
          action_taken?: string | null
          classification?: string
          classification_reason?: string | null
          completed_at?: string | null
          consecutive_failures?: number
          control_category?: string | null
          control_providers_attempted?: string[] | null
          control_providers_succeeded?: string[] | null
          control_radicado?: string | null
          control_radicado_id?: string | null
          control_run_status?: string | null
          control_trace_id?: string | null
          created_at?: string
          id?: string
          incident_id?: string | null
          organization_id?: string
          recheck_providers_attempted?: string[] | null
          recheck_providers_succeeded?: string[] | null
          recheck_status?: string | null
          recheck_trace_id?: string | null
          started_at?: string
          trigger_reason?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghost_verification_runs_control_radicado_id_fkey"
            columns: ["control_radicado_id"]
            isOneToOne: false
            referencedRelation: "control_radicados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghost_verification_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ghost_verification_runs_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      hearings: {
        Row: {
          auto_detected: boolean | null
          cpaca_process_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          filing_id: string | null
          id: string
          is_virtual: boolean | null
          location: string | null
          notes: string | null
          organization_id: string | null
          owner_id: string
          reminder_sent: boolean | null
          scheduled_at: string
          teams_link: string | null
          title: string
          updated_at: string
          virtual_link: string | null
          work_item_id: string | null
        }
        Insert: {
          auto_detected?: boolean | null
          cpaca_process_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          filing_id?: string | null
          id?: string
          is_virtual?: boolean | null
          location?: string | null
          notes?: string | null
          organization_id?: string | null
          owner_id: string
          reminder_sent?: boolean | null
          scheduled_at: string
          teams_link?: string | null
          title: string
          updated_at?: string
          virtual_link?: string | null
          work_item_id?: string | null
        }
        Update: {
          auto_detected?: boolean | null
          cpaca_process_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          filing_id?: string | null
          id?: string
          is_virtual?: boolean | null
          location?: string | null
          notes?: string | null
          organization_id?: string | null
          owner_id?: string
          reminder_sent?: boolean | null
          scheduled_at?: string
          teams_link?: string | null
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          owner_id?: string
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          rows_updated?: number | null
          rows_valid?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "icarus_import_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      ingestion_runs: {
        Row: {
          created_at: string
          id: string
          ingestion_type: string
          metadata: Json | null
          organization_id: string
          owner_id: string
          rows_duplicate: number | null
          rows_failed: number | null
          rows_imported: number | null
          rows_processed: number | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingestion_type?: string
          metadata?: Json | null
          organization_id: string
          owner_id: string
          rows_duplicate?: number | null
          rows_failed?: number | null
          rows_imported?: number | null
          rows_processed?: number | null
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingestion_type?: string
          metadata?: Json | null
          organization_id?: string
          owner_id?: string
          rows_duplicate?: number | null
          rows_failed?: number | null
          rows_imported?: number | null
          rows_processed?: number | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      job_runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          job_name: string
          metadata: Json
          organization_id: string | null
          processed_count: number | null
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          metadata?: Json
          organization_id?: string | null
          processed_count?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          metadata?: Json
          organization_id?: string | null
          processed_count?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      lexy_daily_messages: {
        Row: {
          alerts_included: Json | null
          closing: string | null
          created_at: string | null
          critical_alerts_count: number | null
          delivered_via: string[] | null
          greeting: string
          highlights: Json | null
          id: string
          message_date: string
          new_actuaciones_count: number | null
          new_publicaciones_count: number | null
          organization_id: string
          seen_at: string | null
          summary_body: string
          user_id: string
          work_items_covered: number | null
        }
        Insert: {
          alerts_included?: Json | null
          closing?: string | null
          created_at?: string | null
          critical_alerts_count?: number | null
          delivered_via?: string[] | null
          greeting: string
          highlights?: Json | null
          id?: string
          message_date: string
          new_actuaciones_count?: number | null
          new_publicaciones_count?: number | null
          organization_id: string
          seen_at?: string | null
          summary_body: string
          user_id: string
          work_items_covered?: number | null
        }
        Update: {
          alerts_included?: Json | null
          closing?: string | null
          created_at?: string | null
          critical_alerts_count?: number | null
          delivered_via?: string[] | null
          greeting?: string
          highlights?: Json | null
          id?: string
          message_date?: string
          new_actuaciones_count?: number | null
          new_publicaciones_count?: number | null
          organization_id?: string
          seen_at?: string | null
          summary_body?: string
          user_id?: string
          work_items_covered?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lexy_daily_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      master_sync_runs: {
        Row: {
          actuaciones_found: number | null
          actuaciones_inserted: number | null
          alerts_created: number | null
          completed_at: string | null
          created_at: string | null
          duration_ms: number | null
          id: string
          include_cpnu: boolean | null
          include_publicaciones: boolean | null
          include_samai: boolean | null
          include_tutelas: boolean | null
          publicaciones_found: number | null
          publicaciones_inserted: number | null
          results_json: Json | null
          started_at: string | null
          status: string | null
          target_organization_id: string
          target_user_id: string | null
          triggered_by_user_id: string
          work_items_error: number | null
          work_items_processed: number | null
          work_items_success: number | null
          work_items_total: number | null
        }
        Insert: {
          actuaciones_found?: number | null
          actuaciones_inserted?: number | null
          alerts_created?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          include_cpnu?: boolean | null
          include_publicaciones?: boolean | null
          include_samai?: boolean | null
          include_tutelas?: boolean | null
          publicaciones_found?: number | null
          publicaciones_inserted?: number | null
          results_json?: Json | null
          started_at?: string | null
          status?: string | null
          target_organization_id: string
          target_user_id?: string | null
          triggered_by_user_id: string
          work_items_error?: number | null
          work_items_processed?: number | null
          work_items_success?: number | null
          work_items_total?: number | null
        }
        Update: {
          actuaciones_found?: number | null
          actuaciones_inserted?: number | null
          alerts_created?: number | null
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          id?: string
          include_cpnu?: boolean | null
          include_publicaciones?: boolean | null
          include_samai?: boolean | null
          include_tutelas?: boolean | null
          publicaciones_found?: number | null
          publicaciones_inserted?: number | null
          results_json?: Json | null
          started_at?: string | null
          status?: string | null
          target_organization_id?: string
          target_user_id?: string | null
          triggered_by_user_id?: string
          work_items_error?: number | null
          work_items_processed?: number | null
          work_items_success?: number | null
          work_items_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "master_sync_runs_target_organization_id_fkey"
            columns: ["target_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      member_support_grants: {
        Row: {
          granted_at: string
          granted_by: string
          id: string
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_support_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      mrr_pricing_config: {
        Row: {
          created_at: string
          description: string | null
          display_name: string | null
          id: string
          is_active: boolean
          monthly_price_usd: number
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          monthly_price_usd?: number
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
          monthly_price_usd?: number
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      notification_recipients: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          enabled: boolean
          id: string
          label: string
          organization_id: string
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          enabled?: boolean
          id?: string
          label: string
          organization_id: string
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          enabled?: boolean
          id?: string
          label?: string
          organization_id?: string
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          alert_categories: string[] | null
          body_template: string | null
          created_at: string
          created_by: string | null
          dedupe_window_minutes: number | null
          deleted_at: string | null
          description: string | null
          email_template_id: string | null
          enabled: boolean
          id: string
          max_per_10min: number | null
          name: string
          organization_id: string
          recipient_emails: string[] | null
          recipient_mode: string
          recipient_role: string | null
          severity_min: string
          subject_template: string | null
          trigger_event: string
          trigger_params: Json | null
          updated_at: string
          use_recipient_directory: boolean | null
          workflow_types: string[] | null
        }
        Insert: {
          alert_categories?: string[] | null
          body_template?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_window_minutes?: number | null
          deleted_at?: string | null
          description?: string | null
          email_template_id?: string | null
          enabled?: boolean
          id?: string
          max_per_10min?: number | null
          name: string
          organization_id: string
          recipient_emails?: string[] | null
          recipient_mode?: string
          recipient_role?: string | null
          severity_min?: string
          subject_template?: string | null
          trigger_event: string
          trigger_params?: Json | null
          updated_at?: string
          use_recipient_directory?: boolean | null
          workflow_types?: string[] | null
        }
        Update: {
          alert_categories?: string[] | null
          body_template?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_window_minutes?: number | null
          deleted_at?: string | null
          description?: string | null
          email_template_id?: string | null
          enabled?: boolean
          id?: string
          max_per_10min?: number | null
          name?: string
          organization_id?: string
          recipient_emails?: string[] | null
          recipient_mode?: string
          recipient_role?: string | null
          severity_min?: string
          subject_template?: string | null
          trigger_event?: string
          trigger_params?: Json | null
          updated_at?: string
          use_recipient_directory?: boolean | null
          workflow_types?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience_scope: Database["public"]["Enums"]["notification_audience"]
          body: string | null
          category: Database["public"]["Enums"]["notification_category"]
          created_at: string
          dedupe_key: string | null
          deep_link: string | null
          dismissed_at: string | null
          id: string
          metadata: Json | null
          org_id: string | null
          read_at: string | null
          severity: string
          title: string
          type: string
          user_id: string | null
          work_item_id: string | null
        }
        Insert: {
          audience_scope: Database["public"]["Enums"]["notification_audience"]
          body?: string | null
          category: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          dedupe_key?: string | null
          deep_link?: string | null
          dismissed_at?: string | null
          id?: string
          metadata?: Json | null
          org_id?: string | null
          read_at?: string | null
          severity?: string
          title: string
          type?: string
          user_id?: string | null
          work_item_id?: string | null
        }
        Update: {
          audience_scope?: Database["public"]["Enums"]["notification_audience"]
          body?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          dedupe_key?: string | null
          deep_link?: string | null
          dismissed_at?: string | null
          id?: string
          metadata?: Json | null
          org_id?: string | null
          read_at?: string | null
          severity?: string
          title?: string
          type?: string
          user_id?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_alert_defaults: {
        Row: {
          alert_cadence_days: number
          alert_channels: string[]
          applies_to_workflow_types: string[] | null
          created_at: string
          email_digest_enabled: boolean
          id: string
          new_actuacion_alert: boolean
          new_estado_alert: boolean
          organization_id: string
          staleness_alert_enabled: boolean
          staleness_threshold_days: number
          task_due_alert: boolean
          updated_at: string
          updated_by: string
        }
        Insert: {
          alert_cadence_days?: number
          alert_channels?: string[]
          applies_to_workflow_types?: string[] | null
          created_at?: string
          email_digest_enabled?: boolean
          id?: string
          new_actuacion_alert?: boolean
          new_estado_alert?: boolean
          organization_id: string
          staleness_alert_enabled?: boolean
          staleness_threshold_days?: number
          task_due_alert?: boolean
          updated_at?: string
          updated_by: string
        }
        Update: {
          alert_cadence_days?: number
          alert_channels?: string[]
          applies_to_workflow_types?: string[] | null
          created_at?: string
          email_digest_enabled?: boolean
          id?: string
          new_actuacion_alert?: boolean
          new_estado_alert?: boolean
          organization_id?: string
          staleness_alert_enabled?: boolean
          staleness_threshold_days?: number
          task_due_alert?: boolean
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_alert_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_alert_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_analytics_overrides: {
        Row: {
          allowed_properties_override: Json | null
          analytics_enabled: boolean | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          session_replay_enabled: boolean | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_properties_override?: Json | null
          analytics_enabled?: boolean | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          session_replay_enabled?: boolean | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_properties_override?: Json | null
          analytics_enabled?: boolean | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          session_replay_enabled?: boolean | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_analytics_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_integration_settings: {
        Row: {
          adapter_priority_order: string[]
          created_at: string
          feature_flags: Json
          organization_id: string
          updated_at: string
          workflow_overrides: Json | null
        }
        Insert: {
          adapter_priority_order?: string[]
          created_at?: string
          feature_flags?: Json
          organization_id: string
          updated_at?: string
          workflow_overrides?: Json | null
        }
        Update: {
          adapter_priority_order?: string[]
          created_at?: string
          feature_flags?: Json
          organization_id?: string
          updated_at?: string
          workflow_overrides?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "org_integration_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_task_templates: {
        Row: {
          category: string
          created_at: string
          created_by: string
          default_cadence_days: number | null
          description: string | null
          id: string
          is_active: boolean
          organization_id: string
          priority: string
          title: string
          updated_at: string
          workflow_types: string[] | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by: string
          default_cadence_days?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          priority?: string
          title: string
          updated_at?: string
          workflow_types?: string[] | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          default_cadence_days?: number | null
          description?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          priority?: string
          title?: string
          updated_at?: string
          workflow_types?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "org_task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_task_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role?: string
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          alert_email: string | null
          alert_email_verified_at: string | null
          created_at: string
          id: string
          organization_id: string
          pending_alert_email: string | null
          pending_alert_email_expires_at: string | null
          pending_alert_email_token_hash: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_email?: string | null
          alert_email_verified_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          pending_alert_email?: string | null
          pending_alert_email_expires_at?: string | null
          pending_alert_email_token_hash?: string | null
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_email?: string | null
          alert_email_verified_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          pending_alert_email?: string | null
          pending_alert_email_expires_at?: string | null
          pending_alert_email_token_hash?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_plan_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          email_sends_per_day: number | null
          email_sends_per_hour: number | null
          file_uploads_per_day: number | null
          id: string
          max_clients: number | null
          max_members: number | null
          max_work_items: number | null
          notes: string | null
          organization_id: string
          storage_mb: number | null
          sync_requests_per_day: number | null
          sync_requests_per_hour: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_sends_per_day?: number | null
          email_sends_per_hour?: number | null
          file_uploads_per_day?: number | null
          id?: string
          max_clients?: number | null
          max_members?: number | null
          max_work_items?: number | null
          notes?: string | null
          organization_id: string
          storage_mb?: number | null
          sync_requests_per_day?: number | null
          sync_requests_per_hour?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_sends_per_day?: number | null
          email_sends_per_hour?: number | null
          file_uploads_per_day?: number | null
          id?: string
          max_clients?: number | null
          max_members?: number | null
          max_work_items?: number | null
          notes?: string | null
          organization_id?: string
          storage_mb?: number | null
          sync_requests_per_day?: number | null
          sync_requests_per_hour?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_plan_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          audit_retention_days: number
          brand_logo_url: string | null
          brand_primary_color: string | null
          brand_tagline: string | null
          created_at: string
          created_by: string | null
          custom_branding_enabled: boolean | null
          custom_firm_name: string | null
          custom_logo_path: string | null
          email_suspend_reason: string | null
          email_suspended: boolean
          email_suspended_at: string | null
          email_suspended_by: string | null
          estados_staleness_alerts_enabled: boolean | null
          estados_staleness_email_enabled: boolean | null
          estados_staleness_threshold_days: number | null
          id: string
          is_active: boolean | null
          max_member_seats: number
          name: string
          show_estados_ticker: boolean
          slug: string | null
          type: string
          updated_at: string
        }
        Insert: {
          audit_retention_days?: number
          brand_logo_url?: string | null
          brand_primary_color?: string | null
          brand_tagline?: string | null
          created_at?: string
          created_by?: string | null
          custom_branding_enabled?: boolean | null
          custom_firm_name?: string | null
          custom_logo_path?: string | null
          email_suspend_reason?: string | null
          email_suspended?: boolean
          email_suspended_at?: string | null
          email_suspended_by?: string | null
          estados_staleness_alerts_enabled?: boolean | null
          estados_staleness_email_enabled?: boolean | null
          estados_staleness_threshold_days?: number | null
          id?: string
          is_active?: boolean | null
          max_member_seats?: number
          name: string
          show_estados_ticker?: boolean
          slug?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          audit_retention_days?: number
          brand_logo_url?: string | null
          brand_primary_color?: string | null
          brand_tagline?: string | null
          created_at?: string
          created_by?: string | null
          custom_branding_enabled?: boolean | null
          custom_firm_name?: string | null
          custom_logo_path?: string | null
          email_suspend_reason?: string | null
          email_suspended?: boolean
          email_suspended_at?: string | null
          email_suspended_by?: string | null
          estados_staleness_alerts_enabled?: boolean | null
          estados_staleness_email_enabled?: boolean | null
          estados_staleness_threshold_days?: number | null
          id?: string
          is_active?: boolean | null
          max_member_seats?: number
          name?: string
          show_estados_ticker?: boolean
          slug?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount_breakdown: Json | null
          amount_cop: number
          billing_cycle_months: number
          checkout_session_id: string | null
          created_at: string | null
          currency: string
          discount_amount_cop: number | null
          discount_code_id: string | null
          gateway: string
          gateway_reference: string | null
          gateway_response: Json | null
          gateway_status: string | null
          gateway_transaction_id: string | null
          id: string
          initiated_by_user_id: string | null
          ip_address: string | null
          organization_id: string
          plan_code: string
          price_point_id: string | null
          status: string
          transaction_type: string
          updated_at: string | null
          verification_checks: Json | null
          verified_at: string | null
          verified_by_action_id: string | null
        }
        Insert: {
          amount_breakdown?: Json | null
          amount_cop: number
          billing_cycle_months?: number
          checkout_session_id?: string | null
          created_at?: string | null
          currency?: string
          discount_amount_cop?: number | null
          discount_code_id?: string | null
          gateway?: string
          gateway_reference?: string | null
          gateway_response?: Json | null
          gateway_status?: string | null
          gateway_transaction_id?: string | null
          id?: string
          initiated_by_user_id?: string | null
          ip_address?: string | null
          organization_id: string
          plan_code: string
          price_point_id?: string | null
          status?: string
          transaction_type?: string
          updated_at?: string | null
          verification_checks?: Json | null
          verified_at?: string | null
          verified_by_action_id?: string | null
        }
        Update: {
          amount_breakdown?: Json | null
          amount_cop?: number
          billing_cycle_months?: number
          checkout_session_id?: string | null
          created_at?: string | null
          currency?: string
          discount_amount_cop?: number | null
          discount_code_id?: string | null
          gateway?: string
          gateway_reference?: string | null
          gateway_response?: Json | null
          gateway_status?: string | null
          gateway_transaction_id?: string | null
          id?: string
          initiated_by_user_id?: string | null
          ip_address?: string | null
          organization_id?: string
          plan_code?: string
          price_point_id?: string | null
          status?: string
          transaction_type?: string
          updated_at?: string | null
          verification_checks?: Json | null
          verified_at?: string | null
          verified_by_action_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "billing_checkout_sessions"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
            foreignKeyName: "peticiones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "peticiones_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pii_encryption_registry: {
        Row: {
          column_name: string
          encrypted_at: string | null
          encryption_method: string
          id: string
          is_encrypted: boolean
          last_audit_at: string | null
          notes: string | null
          table_name: string
        }
        Insert: {
          column_name: string
          encrypted_at?: string | null
          encryption_method?: string
          id?: string
          is_encrypted?: boolean
          last_audit_at?: string | null
          notes?: string | null
          table_name: string
        }
        Update: {
          column_name?: string
          encrypted_at?: string | null
          encryption_method?: string
          id?: string
          is_encrypted?: boolean
          last_audit_at?: string | null
          notes?: string | null
          table_name?: string
        }
        Relationships: []
      }
      plan_limits: {
        Row: {
          created_at: string
          email_sends_per_day: number | null
          email_sends_per_hour: number | null
          features: Json
          file_uploads_per_day: number | null
          id: string
          max_clients: number | null
          max_members: number | null
          max_work_items: number | null
          storage_mb: number | null
          sync_requests_per_day: number | null
          sync_requests_per_hour: number | null
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_sends_per_day?: number | null
          email_sends_per_hour?: number | null
          features?: Json
          file_uploads_per_day?: number | null
          id?: string
          max_clients?: number | null
          max_members?: number | null
          max_work_items?: number | null
          storage_mb?: number | null
          sync_requests_per_day?: number | null
          sync_requests_per_hour?: number | null
          tier: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_sends_per_day?: number | null
          email_sends_per_hour?: number | null
          features?: Json
          file_uploads_per_day?: number | null
          id?: string
          max_clients?: number | null
          max_members?: number | null
          max_work_items?: number | null
          storage_mb?: number | null
          sync_requests_per_day?: number | null
          sync_requests_per_hour?: number | null
          tier?: Database["public"]["Enums"]["plan_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      platform_admin_alert_config: {
        Row: {
          created_at: string
          id: string
          primary_alert_email: string
          secondary_alert_email: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          primary_alert_email?: string
          secondary_alert_email?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          primary_alert_email?: string
          secondary_alert_email?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          notes: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          notes?: string | null
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          notes?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_email_actions: {
        Row: {
          action_type: string
          actor_user_id: string
          created_at: string
          id: string
          metadata: Json | null
          reason: string | null
          target_email_outbox_id: string | null
          target_org_id: string | null
        }
        Insert: {
          action_type: string
          actor_user_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          target_email_outbox_id?: string | null
          target_org_id?: string | null
        }
        Update: {
          action_type?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          target_email_outbox_id?: string | null
          target_org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_email_actions_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_gateway_config: {
        Row: {
          config_key: string
          config_value: string
          created_at: string
          environment: string
          gateway: string
          id: string
          is_secret: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config_key: string
          config_value: string
          created_at?: string
          environment?: string
          gateway?: string
          id?: string
          is_secret?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: string
          created_at?: string
          environment?: string
          gateway?: string
          id?: string
          is_secret?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_job_heartbeats: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          invoked_by: string
          job_name: string
          metadata: Json
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          invoked_by?: string
          job_name: string
          metadata?: Json
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          invoked_by?: string
          job_name?: string
          metadata?: Json
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      platform_notifications: {
        Row: {
          created_at: string
          event_type: string
          id: string
          is_read: boolean
          message: string
          metadata: Json
          organization_id: string | null
          severity: string
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          is_read?: boolean
          message: string
          metadata?: Json
          organization_id?: string | null
          severity?: string
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json
          organization_id?: string | null
          severity?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          analytics_allowed_properties: Json
          analytics_enabled_global: boolean
          analytics_hash_secret_configured: boolean
          analytics_last_event_at: string | null
          analytics_posthog_host: string | null
          created_at: string
          daily_welcome_enabled: boolean
          email_enabled: boolean
          email_pause_reason: string | null
          email_paused_at: string | null
          email_paused_by: string | null
          email_provider_configured: boolean
          email_provider_configured_at: string | null
          email_provider_configured_by: string | null
          email_provider_environment: string | null
          email_provider_type: string | null
          gemini_master_enabled: boolean
          gemini_org_admin_enabled: boolean
          gemini_super_admin_enabled: boolean
          gemini_user_enabled: boolean
          id: string
          max_emails_per_org_per_day: number | null
          max_emails_per_org_per_hour: number | null
          max_global_emails_per_minute: number | null
          max_retry_attempts: number | null
          posthog_enabled: boolean
          sentry_enabled: boolean
          session_replay_enabled: boolean
          spike_detection_enabled: boolean | null
          spike_threshold_multiplier: number | null
          updated_at: string
        }
        Insert: {
          analytics_allowed_properties?: Json
          analytics_enabled_global?: boolean
          analytics_hash_secret_configured?: boolean
          analytics_last_event_at?: string | null
          analytics_posthog_host?: string | null
          created_at?: string
          daily_welcome_enabled?: boolean
          email_enabled?: boolean
          email_pause_reason?: string | null
          email_paused_at?: string | null
          email_paused_by?: string | null
          email_provider_configured?: boolean
          email_provider_configured_at?: string | null
          email_provider_configured_by?: string | null
          email_provider_environment?: string | null
          email_provider_type?: string | null
          gemini_master_enabled?: boolean
          gemini_org_admin_enabled?: boolean
          gemini_super_admin_enabled?: boolean
          gemini_user_enabled?: boolean
          id?: string
          max_emails_per_org_per_day?: number | null
          max_emails_per_org_per_hour?: number | null
          max_global_emails_per_minute?: number | null
          max_retry_attempts?: number | null
          posthog_enabled?: boolean
          sentry_enabled?: boolean
          session_replay_enabled?: boolean
          spike_detection_enabled?: boolean | null
          spike_threshold_multiplier?: number | null
          updated_at?: string
        }
        Update: {
          analytics_allowed_properties?: Json
          analytics_enabled_global?: boolean
          analytics_hash_secret_configured?: boolean
          analytics_last_event_at?: string | null
          analytics_posthog_host?: string | null
          created_at?: string
          daily_welcome_enabled?: boolean
          email_enabled?: boolean
          email_pause_reason?: string | null
          email_paused_at?: string | null
          email_paused_by?: string | null
          email_provider_configured?: boolean
          email_provider_configured_at?: string | null
          email_provider_configured_by?: string | null
          email_provider_environment?: string | null
          email_provider_type?: string | null
          gemini_master_enabled?: boolean
          gemini_org_admin_enabled?: boolean
          gemini_super_admin_enabled?: boolean
          gemini_user_enabled?: boolean
          id?: string
          max_emails_per_org_per_day?: number | null
          max_emails_per_org_per_hour?: number | null
          max_global_emails_per_minute?: number | null
          max_retry_attempts?: number | null
          posthog_enabled?: boolean
          sentry_enabled?: boolean
          session_replay_enabled?: boolean
          spike_detection_enabled?: boolean | null
          spike_threshold_multiplier?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_voucher_events: {
        Row: {
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          voucher_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          voucher_id: string
        }
        Update: {
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_voucher_events_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "platform_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_vouchers: {
        Row: {
          amount_cop_incl_iva: number
          code: string
          created_at: string
          created_by_user_id: string
          currency: string
          duration_days: number
          expires_at: string | null
          id: string
          note: string | null
          plan_code: string
          recipient_email: string
          redeemed_at: string | null
          redeemed_by_user_id: string | null
          redeemed_for_org_id: string | null
          status: string
          token_hash: string
          voucher_type: string
        }
        Insert: {
          amount_cop_incl_iva?: number
          code: string
          created_at?: string
          created_by_user_id: string
          currency?: string
          duration_days?: number
          expires_at?: string | null
          id?: string
          note?: string | null
          plan_code: string
          recipient_email: string
          redeemed_at?: string | null
          redeemed_by_user_id?: string | null
          redeemed_for_org_id?: string | null
          status?: string
          token_hash: string
          voucher_type: string
        }
        Update: {
          amount_cop_incl_iva?: number
          code?: string
          created_at?: string
          created_by_user_id?: string
          currency?: string
          duration_days?: number
          expires_at?: string | null
          id?: string
          note?: string | null
          plan_code?: string
          recipient_email?: string
          redeemed_at?: string | null
          redeemed_by_user_id?: string | null
          redeemed_for_org_id?: string | null
          status?: string
          token_hash?: string
          voucher_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_vouchers_redeemed_for_org_id_fkey"
            columns: ["redeemed_for_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_policy_versions: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          database_validity_clause_present: boolean
          effective_date: string
          id: string
          text: string
          text_hash: string
          title: string
          version: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          database_validity_clause_present?: boolean
          effective_date?: string
          id?: string
          text: string
          text_hash: string
          title?: string
          version: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          database_validity_clause_present?: boolean
          effective_date?: string
          id?: string
          text?: string
          text_hash?: string
          title?: string
          version?: string
        }
        Relationships: []
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
          hash_fingerprint: string | null
          id: string
          organization_id: string | null
          owner_id: string
          raw_data: Json | null
          source: string | null
          source_url: string | null
          title: string | null
          work_item_id: string | null
        }
        Insert: {
          attachments?: Json | null
          created_at?: string
          description: string
          detail?: string | null
          detected_milestones?: Json | null
          event_date?: string | null
          event_type: string
          hash_fingerprint?: string | null
          id?: string
          organization_id?: string | null
          owner_id: string
          raw_data?: Json | null
          source?: string | null
          source_url?: string | null
          title?: string | null
          work_item_id?: string | null
        }
        Update: {
          attachments?: Json | null
          created_at?: string
          description?: string
          detail?: string | null
          detected_milestones?: Json | null
          event_date?: string | null
          event_type?: string
          hash_fingerprint?: string | null
          id?: string
          organization_id?: string | null
          owner_id?: string
          raw_data?: Json | null
          source?: string | null
          source_url?: string | null
          title?: string | null
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "process_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "process_events_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          auth_provider: string | null
          avatar_url: string | null
          created_at: string
          custom_branding_enabled: boolean | null
          custom_firm_name: string | null
          custom_logo_path: string | null
          default_alert_email: string | null
          email: string | null
          email_reminders_enabled: boolean | null
          estados_import_interval_days: number | null
          firm_name: string | null
          firma_abogado_cc: string | null
          firma_abogado_correo: string | null
          firma_abogado_nombre_completo: string | null
          firma_abogado_tp: string | null
          full_name: string | null
          generic_email_verified: boolean | null
          hearing_reminder_days: Json | null
          id: string
          is_generic_email: boolean | null
          last_estados_import_at: string | null
          last_welcome_date: string | null
          litigation_email: string | null
          mascot_preferences: Json | null
          organization_id: string | null
          pending_terms_acceptance: boolean
          phone: string | null
          professional_address: string | null
          profile_completed_at: string | null
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
          address?: string | null
          auth_provider?: string | null
          avatar_url?: string | null
          created_at?: string
          custom_branding_enabled?: boolean | null
          custom_firm_name?: string | null
          custom_logo_path?: string | null
          default_alert_email?: string | null
          email?: string | null
          email_reminders_enabled?: boolean | null
          estados_import_interval_days?: number | null
          firm_name?: string | null
          firma_abogado_cc?: string | null
          firma_abogado_correo?: string | null
          firma_abogado_nombre_completo?: string | null
          firma_abogado_tp?: string | null
          full_name?: string | null
          generic_email_verified?: boolean | null
          hearing_reminder_days?: Json | null
          id: string
          is_generic_email?: boolean | null
          last_estados_import_at?: string | null
          last_welcome_date?: string | null
          litigation_email?: string | null
          mascot_preferences?: Json | null
          organization_id?: string | null
          pending_terms_acceptance?: boolean
          phone?: string | null
          professional_address?: string | null
          profile_completed_at?: string | null
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
          address?: string | null
          auth_provider?: string | null
          avatar_url?: string | null
          created_at?: string
          custom_branding_enabled?: boolean | null
          custom_firm_name?: string | null
          custom_logo_path?: string | null
          default_alert_email?: string | null
          email?: string | null
          email_reminders_enabled?: boolean | null
          estados_import_interval_days?: number | null
          firm_name?: string | null
          firma_abogado_cc?: string | null
          firma_abogado_correo?: string | null
          firma_abogado_nombre_completo?: string | null
          firma_abogado_tp?: string | null
          full_name?: string | null
          generic_email_verified?: boolean | null
          hearing_reminder_days?: Json | null
          id?: string
          is_generic_email?: boolean | null
          last_estados_import_at?: string | null
          last_welcome_date?: string | null
          litigation_email?: string | null
          mascot_preferences?: Json | null
          organization_id?: string | null
          pending_terms_acceptance?: boolean
          phone?: string | null
          professional_address?: string | null
          profile_completed_at?: string | null
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
      provider_ai_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json
          role: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_ai_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "provider_ai_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_ai_sessions: {
        Row: {
          actor_user_id: string
          created_at: string
          id: string
          mode: string
          organization_id: string | null
          wizard_run_id: string | null
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          id?: string
          mode: string
          organization_id?: string | null
          wizard_run_id?: string | null
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          id?: string
          mode?: string
          organization_id?: string | null
          wizard_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_ai_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_category_policies: {
        Row: {
          allow_merge_on_empty: boolean
          created_at: string
          id: string
          merge_budget_max_ms: number
          merge_budget_max_providers: number
          merge_mode: string
          organization_id: string
          scope: string
          strategy: string
          updated_at: string
          workflow: string
        }
        Insert: {
          allow_merge_on_empty?: boolean
          created_at?: string
          id?: string
          merge_budget_max_ms?: number
          merge_budget_max_providers?: number
          merge_mode?: string
          organization_id: string
          scope?: string
          strategy?: string
          updated_at?: string
          workflow: string
        }
        Update: {
          allow_merge_on_empty?: boolean
          created_at?: string
          id?: string
          merge_budget_max_ms?: number
          merge_budget_max_providers?: number
          merge_mode?: string
          organization_id?: string
          scope?: string
          strategy?: string
          updated_at?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_category_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_category_policies_global: {
        Row: {
          allow_merge_on_empty: boolean
          created_at: string
          enabled: boolean
          id: string
          max_provider_attempts_per_run: number
          merge_budget_max_ms: number
          merge_budget_max_providers: number
          merge_mode: string
          override_mode: string
          scope: string
          strategy: string
          updated_at: string
          workflow: string
        }
        Insert: {
          allow_merge_on_empty?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          max_provider_attempts_per_run?: number
          merge_budget_max_ms?: number
          merge_budget_max_providers?: number
          merge_mode?: string
          override_mode?: string
          scope?: string
          strategy?: string
          updated_at?: string
          workflow: string
        }
        Update: {
          allow_merge_on_empty?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          max_provider_attempts_per_run?: number
          merge_budget_max_ms?: number
          merge_budget_max_providers?: number
          merge_mode?: string
          override_mode?: string
          scope?: string
          strategy?: string
          updated_at?: string
          workflow?: string
        }
        Relationships: []
      }
      provider_category_policies_org_override: {
        Row: {
          allow_merge_on_empty: boolean
          created_at: string
          enabled: boolean
          id: string
          max_provider_attempts_per_run: number
          merge_budget_max_ms: number
          merge_budget_max_providers: number
          merge_mode: string
          organization_id: string
          override_mode: string
          scope: string
          strategy: string
          updated_at: string
          workflow: string
        }
        Insert: {
          allow_merge_on_empty?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          max_provider_attempts_per_run?: number
          merge_budget_max_ms?: number
          merge_budget_max_providers?: number
          merge_mode?: string
          organization_id: string
          override_mode?: string
          scope: string
          strategy?: string
          updated_at?: string
          workflow: string
        }
        Update: {
          allow_merge_on_empty?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          max_provider_attempts_per_run?: number
          merge_budget_max_ms?: number
          merge_budget_max_providers?: number
          merge_mode?: string
          organization_id?: string
          override_mode?: string
          scope?: string
          strategy?: string
          updated_at?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_category_policies_org_override_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_category_routes: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_authoritative: boolean
          organization_id: string
          priority: number
          provider_instance_id: string
          route_kind: string
          scope: string
          updated_at: string
          workflow: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_authoritative?: boolean
          organization_id: string
          priority?: number
          provider_instance_id: string
          route_kind: string
          scope?: string
          updated_at?: string
          workflow: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_authoritative?: boolean
          organization_id?: string
          priority?: number
          provider_instance_id?: string
          route_kind?: string
          scope?: string
          updated_at?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_category_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_category_routes_provider_instance_id_fkey"
            columns: ["provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_category_routes_global: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_authoritative: boolean
          priority: number
          provider_connector_id: string
          route_kind: string
          scope: string
          workflow: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_authoritative?: boolean
          priority?: number
          provider_connector_id: string
          route_kind?: string
          scope?: string
          workflow: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_authoritative?: boolean
          priority?: number
          provider_connector_id?: string
          route_kind?: string
          scope?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_category_routes_global_provider_connector_id_fkey"
            columns: ["provider_connector_id"]
            isOneToOne: false
            referencedRelation: "provider_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_category_routes_org_override: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_authoritative: boolean
          organization_id: string
          priority: number
          provider_connector_id: string
          route_kind: string
          scope: string
          updated_at: string
          workflow: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_authoritative?: boolean
          organization_id: string
          priority?: number
          provider_connector_id: string
          route_kind: string
          scope: string
          updated_at?: string
          workflow: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_authoritative?: boolean
          organization_id?: string
          priority?: number
          provider_connector_id?: string
          route_kind?: string
          scope?: string
          updated_at?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_category_routes_org_overrid_provider_connector_id_fkey"
            columns: ["provider_connector_id"]
            isOneToOne: false
            referencedRelation: "provider_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_category_routes_org_override_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_connectors: {
        Row: {
          allowed_domains: string[]
          capabilities: string[]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_enabled: boolean
          key: string
          name: string
          organization_id: string | null
          schema_version: string
          updated_at: string
          visibility: string
        }
        Insert: {
          allowed_domains?: string[]
          capabilities?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          key: string
          name: string
          organization_id?: string | null
          schema_version?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          allowed_domains?: string[]
          capabilities?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          key?: string
          name?: string
          organization_id?: string | null
          schema_version?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_connectors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_coverage_overrides: {
        Row: {
          connector_id: string | null
          created_at: string
          created_by: string | null
          data_kind: string
          enabled: boolean
          execution_mode: string
          id: string
          override_builtin: boolean
          priority: number
          provider_key: string
          provider_role: string
          provider_type: string
          timeout_ms: number | null
          updated_at: string
          workflow_type: string
        }
        Insert: {
          connector_id?: string | null
          created_at?: string
          created_by?: string | null
          data_kind: string
          enabled?: boolean
          execution_mode?: string
          id?: string
          override_builtin?: boolean
          priority?: number
          provider_key: string
          provider_role?: string
          provider_type?: string
          timeout_ms?: number | null
          updated_at?: string
          workflow_type: string
        }
        Update: {
          connector_id?: string | null
          created_at?: string
          created_by?: string | null
          data_kind?: string
          enabled?: boolean
          execution_mode?: string
          id?: string
          override_builtin?: boolean
          priority?: number
          provider_key?: string
          provider_role?: string
          provider_type?: string
          timeout_ms?: number | null
          updated_at?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_coverage_overrides_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "provider_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_instance_secrets: {
        Row: {
          cipher_text: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          key_version: number
          nonce: string
          organization_id: string | null
          provider_instance_id: string
          rotated_at: string | null
          scope: string
        }
        Insert: {
          cipher_text: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_version?: number
          nonce: string
          organization_id?: string | null
          provider_instance_id: string
          rotated_at?: string | null
          scope?: string
        }
        Update: {
          cipher_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_version?: number
          nonce?: string
          organization_id?: string | null
          provider_instance_id?: string
          rotated_at?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_instance_secrets_provider_instance_id_fkey"
            columns: ["provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_instances: {
        Row: {
          auth_type: Database["public"]["Enums"]["provider_auth_type"]
          base_url: string
          connector_id: string
          created_at: string
          created_by: string | null
          created_by_role: string
          id: string
          is_enabled: boolean
          name: string
          organization_id: string | null
          rpm_limit: number
          scope: string
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          auth_type: Database["public"]["Enums"]["provider_auth_type"]
          base_url: string
          connector_id: string
          created_at?: string
          created_by?: string | null
          created_by_role?: string
          id?: string
          is_enabled?: boolean
          name: string
          organization_id?: string | null
          rpm_limit?: number
          scope?: string
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          auth_type?: Database["public"]["Enums"]["provider_auth_type"]
          base_url?: string
          connector_id?: string
          created_at?: string
          created_by?: string | null
          created_by_role?: string
          id?: string
          is_enabled?: boolean
          name?: string
          organization_id?: string | null
          rpm_limit?: number
          scope?: string
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_instances_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "provider_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_mapping_specs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string | null
          provider_connector_id: string
          schema_version: string
          scope: string
          spec: Json
          status: string
          updated_at: string
          visibility: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string | null
          provider_connector_id: string
          schema_version?: string
          scope: string
          spec: Json
          status?: string
          updated_at?: string
          visibility: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string | null
          provider_connector_id?: string
          schema_version?: string
          scope?: string
          spec?: Json
          status?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_mapping_specs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_mapping_specs_provider_connector_id_fkey"
            columns: ["provider_connector_id"]
            isOneToOne: false
            referencedRelation: "provider_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_merge_conflicts: {
        Row: {
          created_at: string
          dedupe_key: string
          field_name: string
          id: string
          organization_id: string
          primary_provider_instance_id: string | null
          primary_value: string | null
          resolved: boolean
          resolved_at: string | null
          scope: string
          secondary_provider_instance_id: string | null
          secondary_value: string | null
          work_item_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          field_name: string
          id?: string
          organization_id: string
          primary_provider_instance_id?: string | null
          primary_value?: string | null
          resolved?: boolean
          resolved_at?: string | null
          scope: string
          secondary_provider_instance_id?: string | null
          secondary_value?: string | null
          work_item_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          field_name?: string
          id?: string
          organization_id?: string
          primary_provider_instance_id?: string | null
          primary_value?: string | null
          resolved?: boolean
          resolved_at?: string | null
          scope?: string
          secondary_provider_instance_id?: string | null
          secondary_value?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_merge_conflicts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_merge_conflicts_primary_provider_instance_id_fkey"
            columns: ["primary_provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_merge_conflicts_secondary_provider_instance_id_fkey"
            columns: ["secondary_provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_raw_snapshots: {
        Row: {
          connector_id: string | null
          fetched_at: string
          http_status: number | null
          id: string
          latency_ms: number | null
          normalized_error_code: string | null
          organization_id: string
          payload: Json
          payload_hash: string
          provider_case_id: string
          provider_instance_id: string
          scope: string
          status: string
          work_item_id: string
        }
        Insert: {
          connector_id?: string | null
          fetched_at?: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          normalized_error_code?: string | null
          organization_id: string
          payload: Json
          payload_hash: string
          provider_case_id: string
          provider_instance_id: string
          scope: string
          status: string
          work_item_id: string
        }
        Update: {
          connector_id?: string | null
          fetched_at?: string
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          normalized_error_code?: string | null
          organization_id?: string
          payload?: Json
          payload_hash?: string
          provider_case_id?: string
          provider_instance_id?: string
          scope?: string
          status?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_raw_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_raw_snapshots_provider_instance_id_fkey"
            columns: ["provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_route_mitigations: {
        Row: {
          applied_at: string | null
          created_by_action_id: string | null
          expired: boolean | null
          expires_at: string
          id: string
          mitigation_type: string
          organization_id: string | null
          provider: string
          reason: string
          scope: string | null
          severity: string | null
        }
        Insert: {
          applied_at?: string | null
          created_by_action_id?: string | null
          expired?: boolean | null
          expires_at: string
          id?: string
          mitigation_type: string
          organization_id?: string | null
          provider: string
          reason: string
          scope?: string | null
          severity?: string | null
        }
        Update: {
          applied_at?: string | null
          created_by_action_id?: string | null
          expired?: boolean | null
          expires_at?: string
          id?: string
          mitigation_type?: string
          organization_id?: string | null
          provider?: string
          reason?: string
          scope?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_route_mitigations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_sync_traces: {
        Row: {
          created_at: string
          id: string
          latency_ms: number | null
          ok: boolean
          organization_id: string
          payload: Json
          provider_instance_id: string | null
          result_code: string | null
          run_id: string
          stage: string
          work_item_id: string | null
          work_item_source_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          latency_ms?: number | null
          ok?: boolean
          organization_id: string
          payload?: Json
          provider_instance_id?: string | null
          result_code?: string | null
          run_id?: string
          stage: string
          work_item_id?: string | null
          work_item_source_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          latency_ms?: number | null
          ok?: boolean
          organization_id?: string
          payload?: Json
          provider_instance_id?: string | null
          result_code?: string | null
          run_id?: string
          stage?: string
          work_item_id?: string | null
          work_item_source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_sync_traces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_wizard_sessions: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          mode: string
          organization_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          mode: string
          organization_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          mode?: string
          organization_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_wizard_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pub_provenance: {
        Row: {
          first_seen_at: string
          id: string
          last_seen_at: string
          provider_event_id: string | null
          provider_instance_id: string
          work_item_pub_id: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          provider_event_id?: string | null
          provider_instance_id: string
          work_item_pub_id: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          provider_event_id?: string | null
          provider_instance_id?: string
          work_item_pub_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pub_provenance_provider_instance_id_fkey"
            columns: ["provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          endpoint: string
          id: string
          key: string
          organization_id: string
          window_start: string
        }
        Insert: {
          count?: number
          endpoint?: string
          id?: string
          key: string
          organization_id: string
          window_start?: string
        }
        Update: {
          count?: number
          endpoint?: string
          id?: string
          key?: string
          organization_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_organization_id_fkey"
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
            foreignKeyName: "scraping_jobs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          created_at: string | null
          description: string
          event_type: string
          id: string
          organization_id: string
          payload: Json | null
          triggered_by: string
          triggered_by_action_id: string | null
          triggered_by_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          event_type: string
          id?: string
          organization_id: string
          payload?: Json | null
          triggered_by?: string
          triggered_by_action_id?: string | null
          triggered_by_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json | null
          triggered_by?: string
          triggered_by_action_id?: string | null
          triggered_by_user_id?: string | null
        }
        Relationships: []
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
          tier: Database["public"]["Enums"]["plan_tier"] | null
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
          tier?: Database["public"]["Enums"]["plan_tier"] | null
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
          tier?: Database["public"]["Enums"]["plan_tier"] | null
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
      support_access_grants: {
        Row: {
          access_type: string
          conversation_id: string | null
          created_at: string
          expires_at: string
          granted_at: string
          granted_to_admin_id: string
          id: string
          organization_id: string
          reason: string | null
          redaction_level: string
          revoked_at: string | null
          revoked_by: string | null
          scope: string
          status: string
          user_id: string
        }
        Insert: {
          access_type?: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          granted_at?: string
          granted_to_admin_id: string
          id?: string
          organization_id: string
          reason?: string | null
          redaction_level?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: string
          status?: string
          user_id: string
        }
        Update: {
          access_type?: string
          conversation_id?: string | null
          created_at?: string
          expires_at?: string
          granted_at?: string
          granted_to_admin_id?: string
          id?: string
          organization_id?: string
          reason?: string | null
          redaction_level?: string
          revoked_at?: string | null
          revoked_by?: string | null
          scope?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_grants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "atenia_ai_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_bundles: {
        Row: {
          bundle_type: string
          consent_shared: boolean
          created_at: string
          id: string
          json_content: Json
          organization_id: string | null
          route_context: string | null
          shared_via_grant_id: string | null
          txt_content: string
          user_id: string
          work_item_id: string | null
        }
        Insert: {
          bundle_type?: string
          consent_shared?: boolean
          created_at?: string
          id?: string
          json_content?: Json
          organization_id?: string | null
          route_context?: string | null
          shared_via_grant_id?: string | null
          txt_content: string
          user_id: string
          work_item_id?: string | null
        }
        Update: {
          bundle_type?: string
          consent_shared?: boolean
          created_at?: string
          id?: string
          json_content?: Json
          organization_id?: string | null
          route_context?: string | null
          shared_via_grant_id?: string | null
          txt_content?: string
          user_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_bundles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_bundles_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_audit_log: {
        Row: {
          acts_count_after: number
          acts_count_before: number
          acts_inserted: number
          acts_skipped: number
          anomaly_details: string | null
          count_decreased: boolean | null
          created_at: string | null
          edge_function: string | null
          error_message: string | null
          id: string
          organization_id: string | null
          provider_latency_ms: number | null
          provider_used: string | null
          publicaciones_count_after: number
          publicaciones_count_before: number
          publicaciones_inserted: number
          publicaciones_skipped: number
          radicado: string | null
          status: string
          sync_type: string
          triggered_by: string | null
          work_item_id: string
          workflow_type: string | null
        }
        Insert: {
          acts_count_after?: number
          acts_count_before?: number
          acts_inserted?: number
          acts_skipped?: number
          anomaly_details?: string | null
          count_decreased?: boolean | null
          created_at?: string | null
          edge_function?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          provider_latency_ms?: number | null
          provider_used?: string | null
          publicaciones_count_after?: number
          publicaciones_count_before?: number
          publicaciones_inserted?: number
          publicaciones_skipped?: number
          radicado?: string | null
          status: string
          sync_type: string
          triggered_by?: string | null
          work_item_id: string
          workflow_type?: string | null
        }
        Update: {
          acts_count_after?: number
          acts_count_before?: number
          acts_inserted?: number
          acts_skipped?: number
          anomaly_details?: string | null
          count_decreased?: boolean | null
          created_at?: string | null
          edge_function?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          provider_latency_ms?: number | null
          provider_used?: string | null
          publicaciones_count_after?: number
          publicaciones_count_before?: number
          publicaciones_inserted?: number
          publicaciones_skipped?: number
          radicado?: string | null
          status?: string
          sync_type?: string
          triggered_by?: string | null
          work_item_id?: string
          workflow_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_audit_log_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_item_failure_tracker: {
        Row: {
          consecutive_failures: number
          created_at: string
          dead_lettered: boolean
          dead_lettered_at: string | null
          dead_lettered_run_id: string | null
          last_failure_at: string | null
          last_failure_reason: string | null
          organization_id: string
          reset_at: string | null
          updated_at: string
          work_item_id: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          dead_lettered?: boolean
          dead_lettered_at?: string | null
          dead_lettered_run_id?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          organization_id: string
          reset_at?: string | null
          updated_at?: string
          work_item_id: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          dead_lettered?: boolean
          dead_lettered_at?: string | null
          dead_lettered_run_id?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          organization_id?: string
          reset_at?: string | null
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_item_failure_tracker_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_item_failure_tracker_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: true
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_retry_queue: {
        Row: {
          attempt: number
          claimed_at: string | null
          created_at: string
          id: string
          kind: string
          last_error_code: string | null
          last_error_message: string | null
          max_attempts: number
          next_run_at: string
          organization_id: string | null
          provider: string
          radicado: string
          scraping_job_id: string | null
          stage: string | null
          updated_at: string
          work_item_id: string
          workflow_type: string
        }
        Insert: {
          attempt?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          kind: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          next_run_at: string
          organization_id?: string | null
          provider: string
          radicado: string
          scraping_job_id?: string | null
          stage?: string | null
          updated_at?: string
          work_item_id: string
          workflow_type: string
        }
        Update: {
          attempt?: number
          claimed_at?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          next_run_at?: string
          organization_id?: string | null
          provider?: string
          radicado?: string
          scraping_job_id?: string | null
          stage?: string | null
          updated_at?: string
          work_item_id?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_retry_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_retry_queue_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_traces: {
        Row: {
          body_preview: string | null
          created_at: string | null
          error_code: string | null
          http_status: number | null
          id: string
          latency_ms: number | null
          message: string | null
          meta: Json | null
          normalized_error_code: string | null
          organization_id: string | null
          owner_id: string | null
          provider: string | null
          step: string
          success: boolean | null
          trace_id: string
          work_item_id: string | null
          workflow_type: string | null
        }
        Insert: {
          body_preview?: string | null
          created_at?: string | null
          error_code?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          message?: string | null
          meta?: Json | null
          normalized_error_code?: string | null
          organization_id?: string | null
          owner_id?: string | null
          provider?: string | null
          step: string
          success?: boolean | null
          trace_id: string
          work_item_id?: string | null
          workflow_type?: string | null
        }
        Update: {
          body_preview?: string | null
          created_at?: string | null
          error_code?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          message?: string | null
          meta?: Json | null
          normalized_error_code?: string | null
          organization_id?: string | null
          owner_id?: string | null
          provider?: string | null
          step?: string
          success?: boolean | null
          trace_id?: string
          work_item_id?: string | null
          workflow_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_traces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_traces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_traces_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_watches: {
        Row: {
          condition_params: Json
          condition_type: string
          created_at: string
          evaluated_at: string | null
          expires_at: string
          id: string
          notification_result: Json | null
          notified_at: string | null
          organization_id: string | null
          status: string
          user_id: string
          work_item_id: string | null
        }
        Insert: {
          condition_params?: Json
          condition_type: string
          created_at?: string
          evaluated_at?: string | null
          expires_at?: string
          id?: string
          notification_result?: Json | null
          notified_at?: string | null
          organization_id?: string | null
          status?: string
          user_id: string
          work_item_id?: string | null
        }
        Update: {
          condition_params?: Json
          condition_type?: string
          created_at?: string
          evaluated_at?: string | null
          expires_at?: string
          id?: string
          notification_result?: Json | null
          notified_at?: string | null
          organization_id?: string | null
          status?: string
          user_id?: string
          work_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_watches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_watches_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      system_config: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      system_email_events: {
        Row: {
          created_at: string
          event_id: string
          event_type: string
          id: string
          payload: Json
          provider: string
        }
        Insert: {
          created_at?: string
          event_id: string
          event_type: string
          id?: string
          payload: Json
          provider: string
        }
        Update: {
          created_at?: string
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          provider?: string
        }
        Relationships: []
      }
      system_email_mailbox: {
        Row: {
          created_at: string
          id: string
          imap_host: string
          imap_port: number
          imap_tls: boolean
          last_sync_at: string | null
          password_secret_id: string | null
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          imap_host?: string
          imap_port?: number
          imap_tls?: boolean
          last_sync_at?: string | null
          password_secret_id?: string | null
          username?: string
        }
        Update: {
          created_at?: string
          id?: string
          imap_host?: string
          imap_port?: number
          imap_tls?: boolean
          last_sync_at?: string | null
          password_secret_id?: string | null
          username?: string
        }
        Relationships: []
      }
      system_email_messages: {
        Row: {
          bcc_raw: Json
          cc_raw: Json
          created_at: string
          deleted_at: string | null
          direction: string
          folder: string
          from_raw: string
          html_body: string | null
          id: string
          is_archived: boolean
          provider: string
          provider_message_id: string | null
          provider_status: string
          received_at: string | null
          sent_at: string | null
          snippet: string | null
          subject: string | null
          text_body: string | null
          to_raw: Json
          updated_at: string
        }
        Insert: {
          bcc_raw?: Json
          cc_raw?: Json
          created_at?: string
          deleted_at?: string | null
          direction: string
          folder?: string
          from_raw: string
          html_body?: string | null
          id?: string
          is_archived?: boolean
          provider?: string
          provider_message_id?: string | null
          provider_status?: string
          received_at?: string | null
          sent_at?: string | null
          snippet?: string | null
          subject?: string | null
          text_body?: string | null
          to_raw?: Json
          updated_at?: string
        }
        Update: {
          bcc_raw?: Json
          cc_raw?: Json
          created_at?: string
          deleted_at?: string | null
          direction?: string
          folder?: string
          from_raw?: string
          html_body?: string | null
          id?: string
          is_archived?: boolean
          provider?: string
          provider_message_id?: string | null
          provider_status?: string
          received_at?: string | null
          sent_at?: string | null
          snippet?: string | null
          subject?: string | null
          text_body?: string | null
          to_raw?: Json
          updated_at?: string
        }
        Relationships: []
      }
      system_email_settings: {
        Row: {
          alert_accent_color: string
          alert_cta_text: string
          alert_cta_url: string
          alert_html_footer: string | null
          alert_html_header: string | null
          alert_logo_url: string | null
          alert_subject_template: string
          created_at: string
          dns_dkim_verified: boolean
          dns_dmarc_verified: boolean
          dns_spf_verified: boolean
          domain_verified_at: string | null
          from_email: string
          from_name: string
          id: string
          inbound_mode: string
          is_enabled: boolean
          last_test_result: string | null
          last_test_sent_at: string | null
          outbound_provider: string
          provider: string
          reply_to: string | null
          updated_at: string
        }
        Insert: {
          alert_accent_color?: string
          alert_cta_text?: string
          alert_cta_url?: string
          alert_html_footer?: string | null
          alert_html_header?: string | null
          alert_logo_url?: string | null
          alert_subject_template?: string
          created_at?: string
          dns_dkim_verified?: boolean
          dns_dmarc_verified?: boolean
          dns_spf_verified?: boolean
          domain_verified_at?: string | null
          from_email?: string
          from_name?: string
          id?: string
          inbound_mode?: string
          is_enabled?: boolean
          last_test_result?: string | null
          last_test_sent_at?: string | null
          outbound_provider?: string
          provider?: string
          reply_to?: string | null
          updated_at?: string
        }
        Update: {
          alert_accent_color?: string
          alert_cta_text?: string
          alert_cta_url?: string
          alert_html_footer?: string | null
          alert_html_header?: string | null
          alert_logo_url?: string | null
          alert_subject_template?: string
          created_at?: string
          dns_dkim_verified?: boolean
          dns_dmarc_verified?: boolean
          dns_spf_verified?: boolean
          domain_verified_at?: string | null
          from_email?: string
          from_name?: string
          id?: string
          inbound_mode?: string
          is_enabled?: boolean
          last_test_result?: string | null
          last_test_sent_at?: string | null
          outbound_provider?: string
          provider?: string
          reply_to?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_email_setup_state: {
        Row: {
          id: string
          last_error_code: string | null
          last_error_message: string | null
          step_from_identity_ok: boolean
          step_inbound_ok: boolean
          step_inbound_selected: boolean
          step_resend_key_ok: boolean
          step_test_send_ok: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          step_from_identity_ok?: boolean
          step_inbound_ok?: boolean
          step_inbound_selected?: boolean
          step_resend_key_ok?: boolean
          step_test_send_ok?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          step_from_identity_ok?: boolean
          step_inbound_ok?: boolean
          step_inbound_selected?: boolean
          step_resend_key_ok?: boolean
          step_test_send_ok?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      system_health_events: {
        Row: {
          created_at: string
          id: string
          message: string | null
          metadata: Json
          organization_id: string | null
          service: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          organization_id?: string | null
          service: string
          status: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          organization_id?: string | null
          service?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_health_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_heartbeat: {
        Row: {
          last_error_at: string | null
          last_message: string | null
          last_ok_at: string | null
          last_status: string
          service: string
          updated_at: string
        }
        Insert: {
          last_error_at?: string | null
          last_message?: string | null
          last_ok_at?: string | null
          last_status?: string
          service: string
          updated_at?: string
        }
        Update: {
          last_error_at?: string | null
          last_message?: string | null
          last_ok_at?: string | null
          last_status?: string
          service?: string
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          auto_generated: boolean | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          due_at: string
          filing_id: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          owner_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          due_at: string
          filing_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          owner_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          type: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          due_at?: string
          filing_id?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          owner_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          type?: Database["public"]["Enums"]["task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      terms_acceptance: {
        Row: {
          acceptance_method: string
          accepted_at: string
          checkbox_age: boolean
          checkbox_marketing: boolean
          checkbox_terms: boolean
          created_at: string
          id: string
          ip_address: string | null
          locale: string | null
          operador_nit: string
          operador_razon_social: string
          privacy_policy_text_hash: string | null
          privacy_policy_version: string | null
          scroll_gated: boolean | null
          server_received_at: string | null
          terms_last_updated_date: string
          terms_text_hash: string
          terms_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          acceptance_method?: string
          accepted_at?: string
          checkbox_age?: boolean
          checkbox_marketing?: boolean
          checkbox_terms?: boolean
          created_at?: string
          id?: string
          ip_address?: string | null
          locale?: string | null
          operador_nit?: string
          operador_razon_social?: string
          privacy_policy_text_hash?: string | null
          privacy_policy_version?: string | null
          scroll_gated?: boolean | null
          server_received_at?: string | null
          terms_last_updated_date: string
          terms_text_hash: string
          terms_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          acceptance_method?: string
          accepted_at?: string
          checkbox_age?: boolean
          checkbox_marketing?: boolean
          checkbox_terms?: boolean
          created_at?: string
          id?: string
          ip_address?: string | null
          locale?: string | null
          operador_nit?: string
          operador_razon_social?: string
          privacy_policy_text_hash?: string | null
          privacy_policy_version?: string | null
          scroll_gated?: boolean | null
          server_received_at?: string | null
          terms_last_updated_date?: string
          terms_text_hash?: string
          terms_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      terms_versions: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          last_updated: string
          text: string
          text_hash: string
          title: string
          version: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          last_updated?: string
          text: string
          text_hash: string
          title?: string
          version: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          last_updated?: string
          text?: string
          text_hash?: string
          title?: string
          version?: string
        }
        Relationships: []
      }
      trial_vouchers: {
        Row: {
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          extension_days: number
          id: string
          notes: string | null
          restricted_org_id: string | null
          revoked_at: string | null
          usage_count: number
          usage_limit: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          extension_days: number
          id?: string
          notes?: string | null
          restricted_org_id?: string | null
          revoked_at?: string | null
          usage_count?: number
          usage_limit?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          extension_days?: number
          id?: string
          notes?: string | null
          restricted_org_id?: string | null
          revoked_at?: string | null
          usage_count?: number
          usage_limit?: number
        }
        Relationships: [
          {
            foreignKeyName: "trial_vouchers_restricted_org_id_fkey"
            columns: ["restricted_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trigger_error_log: {
        Row: {
          created_at: string | null
          error_message: string
          id: string
          sqlstate: string | null
          table_name: string
          trigger_name: string
          work_item_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message: string
          id?: string
          sqlstate?: string | null
          table_name: string
          trigger_name: string
          work_item_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string
          id?: string
          sqlstate?: string | null
          table_name?: string
          trigger_name?: string
          work_item_id?: string | null
        }
        Relationships: []
      }
      user_data_alerts: {
        Row: {
          alert_type: string
          created_at: string | null
          dismissed_at: string | null
          id: string
          is_read: boolean | null
          message: string
          organization_id: string
          severity: string
          user_id: string
          work_item_id: string
        }
        Insert: {
          alert_type: string
          created_at?: string | null
          dismissed_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          organization_id: string
          severity?: string
          user_id: string
          work_item_id: string
        }
        Update: {
          alert_type?: string
          created_at?: string | null
          dismissed_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          organization_id?: string
          severity?: string
          user_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_data_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_data_alerts_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback: {
        Row: {
          created_at: string
          email: string
          feedback_type: string
          id: string
          message: string
          name: string
          organization_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          feedback_type: string
          id?: string
          message: string
          name: string
          organization_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          feedback_type?: string
          id?: string
          message?: string
          name?: string
          organization_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          email_alerts_enabled: boolean | null
          id: string
          organization_id: string
          ui_alerts_enabled: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_alerts_enabled?: boolean | null
          id?: string
          organization_id: string
          ui_alerts_enabled?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_alerts_enabled?: boolean | null
          id?: string
          organization_id?: string
          ui_alerts_enabled?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      voucher_redemptions: {
        Row: {
          extension_applied_days: number
          id: string
          organization_id: string
          redeemed_at: string
          redeemed_by: string
          voucher_id: string
        }
        Insert: {
          extension_applied_days: number
          id?: string
          organization_id: string
          redeemed_at?: string
          redeemed_by: string
          voucher_id: string
        }
        Update: {
          extension_applied_days?: number
          id?: string
          organization_id?: string
          redeemed_at?: string
          redeemed_by?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voucher_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_redemptions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "trial_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_signups: {
        Row: {
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          launch_date_used: string | null
          notified_at: string | null
          referrer: string | null
          source_route: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          launch_date_used?: string | null
          notified_at?: string | null
          referrer?: string | null
          source_route?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          launch_date_used?: string | null
          notified_at?: string | null
          referrer?: string | null
          source_route?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
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
      work_item_act_extras: {
        Row: {
          created_at: string
          extras: Json
          updated_at: string
          work_item_act_id: string
        }
        Insert: {
          created_at?: string
          extras?: Json
          updated_at?: string
          work_item_act_id: string
        }
        Update: {
          created_at?: string
          extras?: Json
          updated_at?: string
          work_item_act_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_act_extras_work_item_act_id_fkey"
            columns: ["work_item_act_id"]
            isOneToOne: true
            referencedRelation: "work_item_acts"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_acts: {
        Row: {
          act_date: string | null
          act_date_raw: string | null
          act_type: string | null
          api_fetched_at: string | null
          api_scraped_at: string | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          canonical_at: string | null
          changed_at: string | null
          confidence_level: string | null
          content_hash: string
          created_at: string
          date_confidence: string | null
          date_source: string | null
          description: string
          despacho: string | null
          detected_at: string
          event_category: string | null
          event_date: string | null
          event_summary: string | null
          event_type_normalized: string | null
          hash_fingerprint: string
          id: string
          is_archived: boolean | null
          is_canonical: boolean | null
          is_notifiable: boolean | null
          is_retroactive: boolean | null
          keywords_matched: string[] | null
          last_seen_at: string
          organization_id: string | null
          owner_id: string
          parsing_errors: string[] | null
          phase_inferred: number | null
          provenance: Json | null
          provider_case_id: string | null
          provider_instance_id: string | null
          raw_data: Json | null
          raw_schema_version: string | null
          scrape_date: string | null
          source: string | null
          source_platform: string | null
          source_reference: string | null
          source_url: string | null
          sources: string[] | null
          updated_at: string
          work_item_id: string
          workflow_type: string | null
        }
        Insert: {
          act_date?: string | null
          act_date_raw?: string | null
          act_type?: string | null
          api_fetched_at?: string | null
          api_scraped_at?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          canonical_at?: string | null
          changed_at?: string | null
          confidence_level?: string | null
          content_hash?: string
          created_at?: string
          date_confidence?: string | null
          date_source?: string | null
          description: string
          despacho?: string | null
          detected_at?: string
          event_category?: string | null
          event_date?: string | null
          event_summary?: string | null
          event_type_normalized?: string | null
          hash_fingerprint: string
          id?: string
          is_archived?: boolean | null
          is_canonical?: boolean | null
          is_notifiable?: boolean | null
          is_retroactive?: boolean | null
          keywords_matched?: string[] | null
          last_seen_at?: string
          organization_id?: string | null
          owner_id: string
          parsing_errors?: string[] | null
          phase_inferred?: number | null
          provenance?: Json | null
          provider_case_id?: string | null
          provider_instance_id?: string | null
          raw_data?: Json | null
          raw_schema_version?: string | null
          scrape_date?: string | null
          source?: string | null
          source_platform?: string | null
          source_reference?: string | null
          source_url?: string | null
          sources?: string[] | null
          updated_at?: string
          work_item_id: string
          workflow_type?: string | null
        }
        Update: {
          act_date?: string | null
          act_date_raw?: string | null
          act_type?: string | null
          api_fetched_at?: string | null
          api_scraped_at?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          canonical_at?: string | null
          changed_at?: string | null
          confidence_level?: string | null
          content_hash?: string
          created_at?: string
          date_confidence?: string | null
          date_source?: string | null
          description?: string
          despacho?: string | null
          detected_at?: string
          event_category?: string | null
          event_date?: string | null
          event_summary?: string | null
          event_type_normalized?: string | null
          hash_fingerprint?: string
          id?: string
          is_archived?: boolean | null
          is_canonical?: boolean | null
          is_notifiable?: boolean | null
          is_retroactive?: boolean | null
          keywords_matched?: string[] | null
          last_seen_at?: string
          organization_id?: string | null
          owner_id?: string
          parsing_errors?: string[] | null
          phase_inferred?: number | null
          provenance?: Json | null
          provider_case_id?: string | null
          provider_instance_id?: string | null
          raw_data?: Json | null
          raw_schema_version?: string | null
          scrape_date?: string | null
          source?: string | null
          source_platform?: string | null
          source_reference?: string | null
          source_url?: string | null
          sources?: string[] | null
          updated_at?: string
          work_item_id?: string
          workflow_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_item_acts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
      work_item_coverage_gaps: {
        Row: {
          created_at: string
          data_kind: string
          despacho: string | null
          first_seen_at: string
          id: string
          last_http_status: number | null
          last_response_redacted: Json | null
          last_seen_at: string
          occurrences: number
          org_id: string
          provider_key: string
          radicado: string
          status: string
          work_item_id: string
          workflow: string
        }
        Insert: {
          created_at?: string
          data_kind: string
          despacho?: string | null
          first_seen_at?: string
          id?: string
          last_http_status?: number | null
          last_response_redacted?: Json | null
          last_seen_at?: string
          occurrences?: number
          org_id: string
          provider_key: string
          radicado: string
          status?: string
          work_item_id: string
          workflow: string
        }
        Update: {
          created_at?: string
          data_kind?: string
          despacho?: string | null
          first_seen_at?: string
          id?: string
          last_http_status?: number | null
          last_response_redacted?: Json | null
          last_seen_at?: string
          occurrences?: number
          org_id?: string
          provider_key?: string
          radicado?: string
          status?: string
          work_item_id?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_coverage_gaps_work_item_id_fkey"
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          owner_id?: string
          status?: string
          trigger_date?: string
          trigger_event?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_deadlines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_deadlines_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_email_events: {
        Row: {
          actor_type: string
          confidence: number | null
          confirmed_email: string | null
          created_at: string | null
          event_type: string
          evidence: Json | null
          id: string
          source: string | null
          suggested_email: string | null
          work_item_id: string
        }
        Insert: {
          actor_type: string
          confidence?: number | null
          confirmed_email?: string | null
          created_at?: string | null
          event_type: string
          evidence?: Json | null
          id?: string
          source?: string | null
          suggested_email?: string | null
          work_item_id: string
        }
        Update: {
          actor_type?: string
          confidence?: number | null
          confirmed_email?: string | null
          created_at?: string | null
          event_type?: string
          evidence?: Json | null
          id?: string
          source?: string | null
          suggested_email?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_email_events_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_external_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          label: string | null
          organization_id: string
          url: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label?: string | null
          organization_id: string
          url: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label?: string | null
          organization_id?: string
          url?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_external_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_external_links_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_parties: {
        Row: {
          address: string | null
          cedula: string | null
          cedula_city: string | null
          company_city: string | null
          company_name: string | null
          company_nit: string | null
          created_at: string
          display_order: number
          email: string | null
          id: string
          is_our_client: boolean
          name: string
          organization_id: string | null
          owner_id: string
          party_side: string
          party_type: string
          phone: string | null
          rep_legal_cargo: string | null
          rep_legal_cedula: string | null
          rep_legal_cedula_city: string | null
          rep_legal_email: string | null
          rep_legal_name: string | null
          rep_legal_phone: string | null
          updated_at: string
          work_item_id: string
        }
        Insert: {
          address?: string | null
          cedula?: string | null
          cedula_city?: string | null
          company_city?: string | null
          company_name?: string | null
          company_nit?: string | null
          created_at?: string
          display_order?: number
          email?: string | null
          id?: string
          is_our_client?: boolean
          name: string
          organization_id?: string | null
          owner_id: string
          party_side?: string
          party_type?: string
          phone?: string | null
          rep_legal_cargo?: string | null
          rep_legal_cedula?: string | null
          rep_legal_cedula_city?: string | null
          rep_legal_email?: string | null
          rep_legal_name?: string | null
          rep_legal_phone?: string | null
          updated_at?: string
          work_item_id: string
        }
        Update: {
          address?: string | null
          cedula?: string | null
          cedula_city?: string | null
          company_city?: string | null
          company_name?: string | null
          company_nit?: string | null
          created_at?: string
          display_order?: number
          email?: string | null
          id?: string
          is_our_client?: boolean
          name?: string
          organization_id?: string | null
          owner_id?: string
          party_side?: string
          party_type?: string
          phone?: string | null
          rep_legal_cargo?: string | null
          rep_legal_cedula?: string | null
          rep_legal_cedula_city?: string | null
          rep_legal_email?: string | null
          rep_legal_name?: string | null
          rep_legal_phone?: string | null
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_parties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_parties_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_pub_extras: {
        Row: {
          created_at: string
          extras: Json
          updated_at: string
          work_item_pub_id: string
        }
        Insert: {
          created_at?: string
          extras?: Json
          updated_at?: string
          work_item_pub_id: string
        }
        Update: {
          created_at?: string
          extras?: Json
          updated_at?: string
          work_item_pub_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_pub_extras_work_item_pub_id_fkey"
            columns: ["work_item_pub_id"]
            isOneToOne: true
            referencedRelation: "work_item_publicaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_publicaciones: {
        Row: {
          annotation: string | null
          api_fetched_at: string | null
          api_scraped_at: string | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          canonical_at: string | null
          changed_at: string | null
          content_hash: string
          created_at: string
          date_confidence: string | null
          date_source: string | null
          despacho: string | null
          detected_at: string
          entry_url: string | null
          fecha_desfijacion: string | null
          fecha_fijacion: string | null
          hash_fingerprint: string
          id: string
          is_archived: boolean | null
          is_canonical: boolean | null
          is_notifiable: boolean | null
          last_seen_at: string
          organization_id: string
          pdf_available: boolean | null
          pdf_url: string | null
          provenance: Json | null
          provider_case_id: string | null
          provider_instance_id: string | null
          published_at: string | null
          raw_data: Json | null
          raw_json: Json | null
          raw_schema_version: string | null
          source: string
          sources: string[] | null
          tipo_publicacion: string | null
          title: string
          updated_at: string
          work_item_id: string
        }
        Insert: {
          annotation?: string | null
          api_fetched_at?: string | null
          api_scraped_at?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          canonical_at?: string | null
          changed_at?: string | null
          content_hash?: string
          created_at?: string
          date_confidence?: string | null
          date_source?: string | null
          despacho?: string | null
          detected_at?: string
          entry_url?: string | null
          fecha_desfijacion?: string | null
          fecha_fijacion?: string | null
          hash_fingerprint: string
          id?: string
          is_archived?: boolean | null
          is_canonical?: boolean | null
          is_notifiable?: boolean | null
          last_seen_at?: string
          organization_id: string
          pdf_available?: boolean | null
          pdf_url?: string | null
          provenance?: Json | null
          provider_case_id?: string | null
          provider_instance_id?: string | null
          published_at?: string | null
          raw_data?: Json | null
          raw_json?: Json | null
          raw_schema_version?: string | null
          source?: string
          sources?: string[] | null
          tipo_publicacion?: string | null
          title: string
          updated_at?: string
          work_item_id: string
        }
        Update: {
          annotation?: string | null
          api_fetched_at?: string | null
          api_scraped_at?: string | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          canonical_at?: string | null
          changed_at?: string | null
          content_hash?: string
          created_at?: string
          date_confidence?: string | null
          date_source?: string | null
          despacho?: string | null
          detected_at?: string
          entry_url?: string | null
          fecha_desfijacion?: string | null
          fecha_fijacion?: string | null
          hash_fingerprint?: string
          id?: string
          is_archived?: boolean | null
          is_canonical?: boolean | null
          is_notifiable?: boolean | null
          last_seen_at?: string
          organization_id?: string
          pdf_available?: boolean | null
          pdf_url?: string | null
          provenance?: Json | null
          provider_case_id?: string | null
          provider_instance_id?: string | null
          published_at?: string | null
          raw_data?: Json | null
          raw_json?: Json | null
          raw_schema_version?: string | null
          source?: string
          sources?: string[] | null
          tipo_publicacion?: string | null
          title?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_publicaciones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_publicaciones_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_reminders: {
        Row: {
          cadence_business_days: number
          completed_at: string | null
          created_at: string
          created_by: string | null
          dismissed_at: string | null
          id: string
          last_triggered_at: string | null
          next_run_at: string
          organization_id: string
          owner_id: string
          reminder_type: Database["public"]["Enums"]["reminder_type"]
          snoozed_until: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          trigger_count: number
          updated_at: string
          work_item_id: string
        }
        Insert: {
          cadence_business_days?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dismissed_at?: string | null
          id?: string
          last_triggered_at?: string | null
          next_run_at: string
          organization_id: string
          owner_id: string
          reminder_type: Database["public"]["Enums"]["reminder_type"]
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          trigger_count?: number
          updated_at?: string
          work_item_id: string
        }
        Update: {
          cadence_business_days?: number
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          dismissed_at?: string | null
          id?: string
          last_triggered_at?: string | null
          next_run_at?: string
          organization_id?: string
          owner_id?: string
          reminder_type?: Database["public"]["Enums"]["reminder_type"]
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          trigger_count?: number
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_reminders_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_scrape_jobs: {
        Row: {
          created_at: string | null
          id: string
          job_id: string
          last_poll_result: Json | null
          max_poll_attempts: number | null
          next_poll_at: string
          organization_id: string
          poll_attempts: number | null
          provider: string
          radicado: string
          resolved_by_action_id: string | null
          status: string | null
          work_item_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          job_id: string
          last_poll_result?: Json | null
          max_poll_attempts?: number | null
          next_poll_at: string
          organization_id: string
          poll_attempts?: number | null
          provider?: string
          radicado: string
          resolved_by_action_id?: string | null
          status?: string | null
          work_item_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          job_id?: string
          last_poll_result?: Json | null
          max_poll_attempts?: number | null
          next_poll_at?: string
          organization_id?: string
          poll_attempts?: number | null
          provider?: string
          radicado?: string
          resolved_by_action_id?: string | null
          status?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_scrape_jobs_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_soft_deletes: {
        Row: {
          created_at: string | null
          delete_reason: string | null
          deleted_at: string
          deleted_by_user_id: string
          despacho: string | null
          id: string
          item_snapshot: Json | null
          organization_id: string
          purge_after: string
          purged_at: string | null
          purged_by_action_id: string | null
          radicado: string
          restored_at: string | null
          restored_by_action_id: string | null
          status: string
          work_item_id: string
          workflow_type: string
        }
        Insert: {
          created_at?: string | null
          delete_reason?: string | null
          deleted_at?: string
          deleted_by_user_id: string
          despacho?: string | null
          id?: string
          item_snapshot?: Json | null
          organization_id: string
          purge_after: string
          purged_at?: string | null
          purged_by_action_id?: string | null
          radicado: string
          restored_at?: string | null
          restored_by_action_id?: string | null
          status?: string
          work_item_id: string
          workflow_type: string
        }
        Update: {
          created_at?: string | null
          delete_reason?: string | null
          deleted_at?: string
          deleted_by_user_id?: string
          despacho?: string | null
          id?: string
          item_snapshot?: Json | null
          organization_id?: string
          purge_after?: string
          purged_at?: string | null
          purged_by_action_id?: string | null
          radicado?: string
          restored_at?: string | null
          restored_by_action_id?: string | null
          status?: string
          work_item_id?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_soft_deletes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_soft_deletes_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_sources: {
        Row: {
          consecutive_404_count: number
          consecutive_failures: number
          created_at: string
          created_by: string | null
          id: string
          last_error_code: string | null
          last_error_message: string | null
          last_provider_latency_ms: number | null
          last_synced_at: string | null
          organization_id: string
          provider_case_id: string | null
          provider_instance_id: string
          scrape_status: Database["public"]["Enums"]["work_item_source_scrape_status"]
          source_input_type: string
          source_input_value: string
          source_url: string | null
          status: Database["public"]["Enums"]["work_item_source_status"]
          updated_at: string
          work_item_id: string
        }
        Insert: {
          consecutive_404_count?: number
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_provider_latency_ms?: number | null
          last_synced_at?: string | null
          organization_id: string
          provider_case_id?: string | null
          provider_instance_id: string
          scrape_status?: Database["public"]["Enums"]["work_item_source_scrape_status"]
          source_input_type: string
          source_input_value: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["work_item_source_status"]
          updated_at?: string
          work_item_id: string
        }
        Update: {
          consecutive_404_count?: number
          consecutive_failures?: number
          created_at?: string
          created_by?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_provider_latency_ms?: number | null
          last_synced_at?: string | null
          organization_id?: string
          provider_case_id?: string | null
          provider_instance_id?: string
          scrape_status?: Database["public"]["Enums"]["work_item_source_scrape_status"]
          source_input_type?: string
          source_input_value?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["work_item_source_status"]
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_sources_provider_instance_id_fkey"
            columns: ["provider_instance_id"]
            isOneToOne: false
            referencedRelation: "provider_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_sources_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_stage_audit: {
        Row: {
          actor_user_id: string
          change_source: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          new_cgp_phase: string | null
          new_stage: string | null
          organization_id: string
          previous_cgp_phase: string | null
          previous_stage: string | null
          reason: string | null
          suggestion_confidence: number | null
          suggestion_id: string | null
          user_agent: string | null
          work_item_id: string
        }
        Insert: {
          actor_user_id: string
          change_source: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_cgp_phase?: string | null
          new_stage?: string | null
          organization_id: string
          previous_cgp_phase?: string | null
          previous_stage?: string | null
          reason?: string | null
          suggestion_confidence?: number | null
          suggestion_id?: string | null
          user_agent?: string | null
          work_item_id: string
        }
        Update: {
          actor_user_id?: string
          change_source?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_cgp_phase?: string | null
          new_stage?: string | null
          organization_id?: string
          previous_cgp_phase?: string | null
          previous_stage?: string | null
          reason?: string | null
          suggestion_confidence?: number | null
          suggestion_id?: string | null
          user_agent?: string | null
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_stage_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_stage_audit_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "work_item_stage_suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_stage_audit_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_stage_suggestions: {
        Row: {
          applied_at: string | null
          applied_by_user_id: string | null
          audit_log_id: string | null
          confidence: number
          created_at: string
          event_fingerprint: string | null
          id: string
          organization_id: string
          owner_id: string
          reason: string | null
          source_type: string
          status: string
          suggested_cgp_phase: string | null
          suggested_pipeline_stage: string | null
          suggested_stage: string | null
          updated_at: string
          work_item_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_by_user_id?: string | null
          audit_log_id?: string | null
          confidence: number
          created_at?: string
          event_fingerprint?: string | null
          id?: string
          organization_id: string
          owner_id: string
          reason?: string | null
          source_type: string
          status?: string
          suggested_cgp_phase?: string | null
          suggested_pipeline_stage?: string | null
          suggested_stage?: string | null
          updated_at?: string
          work_item_id: string
        }
        Update: {
          applied_at?: string | null
          applied_by_user_id?: string | null
          audit_log_id?: string | null
          confidence?: number
          created_at?: string
          event_fingerprint?: string | null
          id?: string
          organization_id?: string
          owner_id?: string
          reason?: string | null
          source_type?: string
          status?: string
          suggested_cgp_phase?: string | null
          suggested_pipeline_stage?: string | null
          suggested_stage?: string | null
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_stage_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_stage_suggestions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_stage_suggestions_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_tasks: {
        Row: {
          alert_cadence_days: number | null
          alert_channels: string[]
          alert_enabled: boolean
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          organization_id: string | null
          owner_id: string
          priority: string
          status: string
          template_key: string | null
          title: string
          updated_at: string
          work_item_id: string
        }
        Insert: {
          alert_cadence_days?: number | null
          alert_channels?: string[]
          alert_enabled?: boolean
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string | null
          owner_id: string
          priority?: string
          status?: string
          template_key?: string | null
          title: string
          updated_at?: string
          work_item_id: string
        }
        Update: {
          alert_cadence_days?: number | null
          alert_channels?: string[]
          alert_enabled?: boolean
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string | null
          owner_id?: string
          priority?: string
          status?: string
          template_key?: string | null
          title?: string
          updated_at?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_tasks_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          acta_radicacion_url: string | null
          acta_reparto_notes: string | null
          acta_reparto_received_at: string | null
          acts_initial_sync_completed_at: string | null
          asunto: string | null
          atenia_health_score: number | null
          authority_city: string | null
          authority_department: string | null
          authority_email: string | null
          authority_name: string | null
          auto_admisorio_date: string | null
          auto_admisorio_url: string | null
          cgp_class: string | null
          cgp_cuantia: string | null
          cgp_instancia: string | null
          cgp_phase: Database["public"]["Enums"]["cgp_phase"] | null
          cgp_phase_source:
            | Database["public"]["Enums"]["cgp_phase_source"]
            | null
          cgp_variant: string | null
          clase_proceso: string | null
          client_id: string | null
          consecutive_404_count: number | null
          consecutive_failures: number
          consecutive_not_found: number | null
          corte_status: string | null
          courthouse_directory_id: number | null
          courthouse_email_confidence: number | null
          courthouse_email_confirmed: string | null
          courthouse_email_confirmed_at: string | null
          courthouse_email_evidence: Json | null
          courthouse_email_source: string | null
          courthouse_email_status: string
          courthouse_email_suggested: string | null
          courthouse_email_suggested_at: string | null
          courthouse_needs_review: boolean | null
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          demandados: string | null
          demandantes: string | null
          demonitor_at: string | null
          demonitor_reason: string | null
          description: string | null
          email_linking_enabled: boolean | null
          etapa: string | null
          expediente_url: string | null
          fecha_para_sentencia: string | null
          fecha_presenta_demanda: string | null
          fecha_radicado: string | null
          fecha_sentencia: string | null
          filing_date: string | null
          formato_expediente: string | null
          freshness_sla_hours: number | null
          freshness_tier: string | null
          freshness_violation_at: string | null
          freshness_violation_notified: boolean | null
          ghost_bootstrap_attempts: number | null
          ghost_candidate_at: string | null
          ghost_verification_run_id: string | null
          ghost_verification_status: string | null
          id: string
          is_flagged: boolean | null
          last_action_date: string | null
          last_action_description: string | null
          last_attempted_sync_at: string | null
          last_checked_at: string | null
          last_crawled_at: string | null
          last_error_at: string | null
          last_error_code: string | null
          last_error_meta: Json | null
          last_event_at: string | null
          last_event_summary: string | null
          last_inference_date: string | null
          last_phase_change_at: string | null
          last_scrape_at: string | null
          last_scrape_initiated_at: string | null
          last_stage_change_at: string | null
          last_stage_change_by_user_id: string | null
          last_stage_change_source: string | null
          last_stage_suggestion_at: string | null
          last_stage_suggestion_id: string | null
          last_successful_sync_at: string | null
          last_sync_attempt_at: string | null
          last_synced_at: string | null
          latest_estado_at: string | null
          latest_estado_fingerprint: string | null
          legacy_admin_process_id: string | null
          legacy_cgp_item_id: string | null
          legacy_cpaca_id: string | null
          legacy_peticion_id: string | null
          matter_id: string | null
          medida_cautelar: string | null
          migration_note: string | null
          milestones_cleared_at: string | null
          milestones_cleared_status: string | null
          ministerio_publico: string | null
          monitoring_disabled_at: string | null
          monitoring_disabled_by: string | null
          monitoring_disabled_meta: Json | null
          monitoring_disabled_reason: string | null
          monitoring_enabled: boolean | null
          monitoring_mode: string | null
          monitoring_suspended_at: string | null
          monitoring_suspended_reason: string | null
          naturaleza_proceso: string | null
          notes: string | null
          notification_effective_date: string | null
          notification_substatus: string | null
          onedrive_url: string | null
          organization_id: string | null
          origen: string | null
          owner_id: string
          pipeline_stage: number | null
          ponente: string | null
          provider_reachable: boolean | null
          provider_sources: Json | null
          pubs_initial_sync_completed_at: string | null
          purge_after: string | null
          radicado: string | null
          radicado_blocks: Json | null
          radicado_raw: string | null
          radicado_valid: boolean | null
          radicado_verified: boolean | null
          raw_courthouse_input: Json | null
          resolution_candidates: Json | null
          resolution_confidence: number | null
          resolution_method: string | null
          resolved_at: string | null
          resolved_email: string | null
          samai_consultado_en: string | null
          samai_fuente: string | null
          samai_guid: string | null
          samai_sala_conoce: string | null
          samai_sala_decide: string | null
          samai_veces_en_corporacion: number | null
          scrape_job_id: string | null
          scrape_poll_url: string | null
          scrape_provider: string | null
          scrape_status: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields: Json | null
          scraping_enabled: boolean | null
          sentencia_ref: string | null
          service_object: string | null
          sharepoint_url: string | null
          source: Database["public"]["Enums"]["item_source"]
          source_payload: Json | null
          source_platform: string | null
          source_reference: string | null
          stage: string
          stage_inference_enabled: boolean | null
          status: Database["public"]["Enums"]["item_status"]
          subclase_proceso: string | null
          sync_failure_streak: number | null
          tipo_proceso: string | null
          tipo_recurso: string | null
          title: string | null
          total_actuaciones: number | null
          total_sujetos_procesales: number | null
          tutela_code: string | null
          ubicacion_expediente: string | null
          updated_at: string
          workflow_type: Database["public"]["Enums"]["workflow_type"]
        }
        Insert: {
          acta_radicacion_url?: string | null
          acta_reparto_notes?: string | null
          acta_reparto_received_at?: string | null
          acts_initial_sync_completed_at?: string | null
          asunto?: string | null
          atenia_health_score?: number | null
          authority_city?: string | null
          authority_department?: string | null
          authority_email?: string | null
          authority_name?: string | null
          auto_admisorio_date?: string | null
          auto_admisorio_url?: string | null
          cgp_class?: string | null
          cgp_cuantia?: string | null
          cgp_instancia?: string | null
          cgp_phase?: Database["public"]["Enums"]["cgp_phase"] | null
          cgp_phase_source?:
            | Database["public"]["Enums"]["cgp_phase_source"]
            | null
          cgp_variant?: string | null
          clase_proceso?: string | null
          client_id?: string | null
          consecutive_404_count?: number | null
          consecutive_failures?: number
          consecutive_not_found?: number | null
          corte_status?: string | null
          courthouse_directory_id?: number | null
          courthouse_email_confidence?: number | null
          courthouse_email_confirmed?: string | null
          courthouse_email_confirmed_at?: string | null
          courthouse_email_evidence?: Json | null
          courthouse_email_source?: string | null
          courthouse_email_status?: string
          courthouse_email_suggested?: string | null
          courthouse_email_suggested_at?: string | null
          courthouse_needs_review?: boolean | null
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          demandados?: string | null
          demandantes?: string | null
          demonitor_at?: string | null
          demonitor_reason?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          etapa?: string | null
          expediente_url?: string | null
          fecha_para_sentencia?: string | null
          fecha_presenta_demanda?: string | null
          fecha_radicado?: string | null
          fecha_sentencia?: string | null
          filing_date?: string | null
          formato_expediente?: string | null
          freshness_sla_hours?: number | null
          freshness_tier?: string | null
          freshness_violation_at?: string | null
          freshness_violation_notified?: boolean | null
          ghost_bootstrap_attempts?: number | null
          ghost_candidate_at?: string | null
          ghost_verification_run_id?: string | null
          ghost_verification_status?: string | null
          id?: string
          is_flagged?: boolean | null
          last_action_date?: string | null
          last_action_description?: string | null
          last_attempted_sync_at?: string | null
          last_checked_at?: string | null
          last_crawled_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_error_meta?: Json | null
          last_event_at?: string | null
          last_event_summary?: string | null
          last_inference_date?: string | null
          last_phase_change_at?: string | null
          last_scrape_at?: string | null
          last_scrape_initiated_at?: string | null
          last_stage_change_at?: string | null
          last_stage_change_by_user_id?: string | null
          last_stage_change_source?: string | null
          last_stage_suggestion_at?: string | null
          last_stage_suggestion_id?: string | null
          last_successful_sync_at?: string | null
          last_sync_attempt_at?: string | null
          last_synced_at?: string | null
          latest_estado_at?: string | null
          latest_estado_fingerprint?: string | null
          legacy_admin_process_id?: string | null
          legacy_cgp_item_id?: string | null
          legacy_cpaca_id?: string | null
          legacy_peticion_id?: string | null
          matter_id?: string | null
          medida_cautelar?: string | null
          migration_note?: string | null
          milestones_cleared_at?: string | null
          milestones_cleared_status?: string | null
          ministerio_publico?: string | null
          monitoring_disabled_at?: string | null
          monitoring_disabled_by?: string | null
          monitoring_disabled_meta?: Json | null
          monitoring_disabled_reason?: string | null
          monitoring_enabled?: boolean | null
          monitoring_mode?: string | null
          monitoring_suspended_at?: string | null
          monitoring_suspended_reason?: string | null
          naturaleza_proceso?: string | null
          notes?: string | null
          notification_effective_date?: string | null
          notification_substatus?: string | null
          onedrive_url?: string | null
          organization_id?: string | null
          origen?: string | null
          owner_id: string
          pipeline_stage?: number | null
          ponente?: string | null
          provider_reachable?: boolean | null
          provider_sources?: Json | null
          pubs_initial_sync_completed_at?: string | null
          purge_after?: string | null
          radicado?: string | null
          radicado_blocks?: Json | null
          radicado_raw?: string | null
          radicado_valid?: boolean | null
          radicado_verified?: boolean | null
          raw_courthouse_input?: Json | null
          resolution_candidates?: Json | null
          resolution_confidence?: number | null
          resolution_method?: string | null
          resolved_at?: string | null
          resolved_email?: string | null
          samai_consultado_en?: string | null
          samai_fuente?: string | null
          samai_guid?: string | null
          samai_sala_conoce?: string | null
          samai_sala_decide?: string | null
          samai_veces_en_corporacion?: number | null
          scrape_job_id?: string | null
          scrape_poll_url?: string | null
          scrape_provider?: string | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          scraping_enabled?: boolean | null
          sentencia_ref?: string | null
          service_object?: string | null
          sharepoint_url?: string | null
          source?: Database["public"]["Enums"]["item_source"]
          source_payload?: Json | null
          source_platform?: string | null
          source_reference?: string | null
          stage: string
          stage_inference_enabled?: boolean | null
          status?: Database["public"]["Enums"]["item_status"]
          subclase_proceso?: string | null
          sync_failure_streak?: number | null
          tipo_proceso?: string | null
          tipo_recurso?: string | null
          title?: string | null
          total_actuaciones?: number | null
          total_sujetos_procesales?: number | null
          tutela_code?: string | null
          ubicacion_expediente?: string | null
          updated_at?: string
          workflow_type: Database["public"]["Enums"]["workflow_type"]
        }
        Update: {
          acta_radicacion_url?: string | null
          acta_reparto_notes?: string | null
          acta_reparto_received_at?: string | null
          acts_initial_sync_completed_at?: string | null
          asunto?: string | null
          atenia_health_score?: number | null
          authority_city?: string | null
          authority_department?: string | null
          authority_email?: string | null
          authority_name?: string | null
          auto_admisorio_date?: string | null
          auto_admisorio_url?: string | null
          cgp_class?: string | null
          cgp_cuantia?: string | null
          cgp_instancia?: string | null
          cgp_phase?: Database["public"]["Enums"]["cgp_phase"] | null
          cgp_phase_source?:
            | Database["public"]["Enums"]["cgp_phase_source"]
            | null
          cgp_variant?: string | null
          clase_proceso?: string | null
          client_id?: string | null
          consecutive_404_count?: number | null
          consecutive_failures?: number
          consecutive_not_found?: number | null
          corte_status?: string | null
          courthouse_directory_id?: number | null
          courthouse_email_confidence?: number | null
          courthouse_email_confirmed?: string | null
          courthouse_email_confirmed_at?: string | null
          courthouse_email_evidence?: Json | null
          courthouse_email_source?: string | null
          courthouse_email_status?: string
          courthouse_email_suggested?: string | null
          courthouse_email_suggested_at?: string | null
          courthouse_needs_review?: boolean | null
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          demandados?: string | null
          demandantes?: string | null
          demonitor_at?: string | null
          demonitor_reason?: string | null
          description?: string | null
          email_linking_enabled?: boolean | null
          etapa?: string | null
          expediente_url?: string | null
          fecha_para_sentencia?: string | null
          fecha_presenta_demanda?: string | null
          fecha_radicado?: string | null
          fecha_sentencia?: string | null
          filing_date?: string | null
          formato_expediente?: string | null
          freshness_sla_hours?: number | null
          freshness_tier?: string | null
          freshness_violation_at?: string | null
          freshness_violation_notified?: boolean | null
          ghost_bootstrap_attempts?: number | null
          ghost_candidate_at?: string | null
          ghost_verification_run_id?: string | null
          ghost_verification_status?: string | null
          id?: string
          is_flagged?: boolean | null
          last_action_date?: string | null
          last_action_description?: string | null
          last_attempted_sync_at?: string | null
          last_checked_at?: string | null
          last_crawled_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_error_meta?: Json | null
          last_event_at?: string | null
          last_event_summary?: string | null
          last_inference_date?: string | null
          last_phase_change_at?: string | null
          last_scrape_at?: string | null
          last_scrape_initiated_at?: string | null
          last_stage_change_at?: string | null
          last_stage_change_by_user_id?: string | null
          last_stage_change_source?: string | null
          last_stage_suggestion_at?: string | null
          last_stage_suggestion_id?: string | null
          last_successful_sync_at?: string | null
          last_sync_attempt_at?: string | null
          last_synced_at?: string | null
          latest_estado_at?: string | null
          latest_estado_fingerprint?: string | null
          legacy_admin_process_id?: string | null
          legacy_cgp_item_id?: string | null
          legacy_cpaca_id?: string | null
          legacy_peticion_id?: string | null
          matter_id?: string | null
          medida_cautelar?: string | null
          migration_note?: string | null
          milestones_cleared_at?: string | null
          milestones_cleared_status?: string | null
          ministerio_publico?: string | null
          monitoring_disabled_at?: string | null
          monitoring_disabled_by?: string | null
          monitoring_disabled_meta?: Json | null
          monitoring_disabled_reason?: string | null
          monitoring_enabled?: boolean | null
          monitoring_mode?: string | null
          monitoring_suspended_at?: string | null
          monitoring_suspended_reason?: string | null
          naturaleza_proceso?: string | null
          notes?: string | null
          notification_effective_date?: string | null
          notification_substatus?: string | null
          onedrive_url?: string | null
          organization_id?: string | null
          origen?: string | null
          owner_id?: string
          pipeline_stage?: number | null
          ponente?: string | null
          provider_reachable?: boolean | null
          provider_sources?: Json | null
          pubs_initial_sync_completed_at?: string | null
          purge_after?: string | null
          radicado?: string | null
          radicado_blocks?: Json | null
          radicado_raw?: string | null
          radicado_valid?: boolean | null
          radicado_verified?: boolean | null
          raw_courthouse_input?: Json | null
          resolution_candidates?: Json | null
          resolution_confidence?: number | null
          resolution_method?: string | null
          resolved_at?: string | null
          resolved_email?: string | null
          samai_consultado_en?: string | null
          samai_fuente?: string | null
          samai_guid?: string | null
          samai_sala_conoce?: string | null
          samai_sala_decide?: string | null
          samai_veces_en_corporacion?: number | null
          scrape_job_id?: string | null
          scrape_poll_url?: string | null
          scrape_provider?: string | null
          scrape_status?: Database["public"]["Enums"]["scrape_status"] | null
          scraped_fields?: Json | null
          scraping_enabled?: boolean | null
          sentencia_ref?: string | null
          service_object?: string | null
          sharepoint_url?: string | null
          source?: Database["public"]["Enums"]["item_source"]
          source_payload?: Json | null
          source_platform?: string | null
          source_reference?: string | null
          stage?: string
          stage_inference_enabled?: boolean | null
          status?: Database["public"]["Enums"]["item_status"]
          subclase_proceso?: string | null
          sync_failure_streak?: number | null
          tipo_proceso?: string | null
          tipo_recurso?: string | null
          title?: string | null
          total_actuaciones?: number | null
          total_sujetos_procesales?: number | null
          tutela_code?: string | null
          ubicacion_expediente?: string | null
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
            foreignKeyName: "work_items_courthouse_directory_id_fkey"
            columns: ["courthouse_directory_id"]
            isOneToOne: false
            referencedRelation: "courthouse_directory"
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
            foreignKeyName: "work_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      demo_events_daily_stats: {
        Row: {
          avg_latency_ms: number | null
          category_inferred: string | null
          day: string | null
          event_count: number | null
          event_name: string | null
          outcome: string | null
          p95_latency_ms: number | null
          referrer_domain: string | null
          route: string | null
          unique_sessions: number | null
        }
        Relationships: []
      }
      migration_health_check: {
        Row: {
          dupe_groups: number | null
          max_dupe_count: number | null
          missing_work_item_id: number | null
          pct_mapped: number | null
          table_name: string | null
          total_rows: number | null
          unique_work_items: number | null
          with_work_item_id: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_daily_sync_lock: {
        Args: { p_organization_id: string; p_run_id?: string }
        Returns: Json
      }
      admin_archive_record: {
        Args: { p_reason?: string; p_record_id: string; p_table: string }
        Returns: undefined
      }
      atenia_ai_claim_queue: {
        Args: { _limit?: number }
        Returns: {
          action_type: string
          attempts: number
          created_at: string
          dedupe_key: string | null
          id: string
          last_error: string | null
          lease_heartbeat_at: string | null
          max_attempts: number
          organization_id: string | null
          payload: Json
          priority: number
          provider: string | null
          reason_code: string | null
          run_after: string
          status: string
          updated_at: string
          work_item_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "atenia_ai_remediation_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      atenia_ai_finish_task: {
        Args: { _error?: Json; _status: string; _task_key: string }
        Returns: undefined
      }
      atenia_ai_try_start_task: {
        Args: { _task_key: string; _ttl_seconds?: number }
        Returns: boolean
      }
      atenia_assurance_gates: { Args: never; Returns: Json }
      atenia_finish_cron: {
        Args: { p_details?: Json; p_run_id: string; p_status: string }
        Returns: undefined
      }
      atenia_get_missing_sync_coverage: {
        Args: never
        Returns: {
          attempted_24h: number
          coverage_pct: number
          missing_attempts: number
          total_monitored: number
        }[]
      }
      atenia_get_missing_sync_items: {
        Args: never
        Returns: {
          id: string
          organization_id: string
        }[]
      }
      atenia_subchain_coverage_gate: {
        Args: { p_organization_id?: string }
        Returns: Json
      }
      atenia_try_start_cron: {
        Args: {
          p_job_name: string
          p_lease_seconds?: number
          p_scheduled_for: string
        }
        Returns: {
          ok: boolean
          run_id: string
        }[]
      }
      backfill_work_item_ids: {
        Args: never
        Returns: {
          already_mapped: number
          exceptions: Json
          newly_mapped: number
          table_name: string
          total_rows: number
          unmapped: number
        }[]
      }
      build_dedupe_key: {
        Args: { p_bucket?: string; p_entity_id: string; p_kind: string }
        Returns: string
      }
      canonicalize_legal_text: { Args: { p_text: string }; Returns: string }
      check_and_increment_login_sync: {
        Args: {
          p_max_per_day?: number
          p_organization_id: string
          p_user_id: string
        }
        Returns: Json
      }
      check_inference_rate_limit: {
        Args: { p_timezone?: string; p_work_item_id: string }
        Returns: Json
      }
      cleanup_trigger_error_log: { Args: never; Returns: undefined }
      daily_sync_health_snapshot: {
        Args: { p_days?: number; p_target_date?: string }
        Returns: Json
      }
      freshness_tier_priority: { Args: { tier: string }; Returns: number }
      get_active_terms: {
        Args: never
        Returns: {
          operador_correo: string
          operador_correo_privacidad: string
          operador_domicilio: string
          operador_nit: string
          operador_razon_social: string
          operador_telefono: string
          privacy_text: string
          privacy_text_hash: string
          privacy_version: string
          terms_last_updated: string
          terms_text: string
          terms_text_hash: string
          terms_version: string
        }[]
      }
      get_adapter_performance_comparison: {
        Args: never
        Returns: {
          baseline_count: number
          baseline_error_rate: number
          baseline_p50_ms: number
          provider: string
          recent_count: number
          recent_error_rate: number
          recent_p50_ms: number
        }[]
      }
      get_chain_org_history: {
        Args: { p_chain_id: string; p_org_id: string }
        Returns: {
          continuation_block_reason: string
          created_at: string
          dead_letter_count: number
          failure_reason: string
          finished_at: string
          id: string
          is_continuation: boolean
          items_failed: number
          items_skipped: number
          items_succeeded: number
          started_at: string
          status: string
        }[]
      }
      get_chain_progress: {
        Args: { p_chain_id: string }
        Returns: {
          chain_id: string
          continuation_block_reason: string
          created_at: string
          dead_letter_count: number
          finished_at: string
          items_failed: number
          items_skipped: number
          items_succeeded: number
          organization_id: string
          started_at: string
          status: string
          timeout_count: number
          trigger_source: string
        }[]
      }
      get_data_protection_summary: { Args: never; Returns: Json }
      get_effective_alert_email: {
        Args: { p_membership_id: string }
        Returns: string
      }
      get_effective_limits: { Args: { p_org_id: string }; Returns: Json }
      get_login_sync_status: {
        Args: {
          p_max_per_day?: number
          p_organization_id: string
          p_user_id: string
        }
        Returns: Json
      }
      get_pending_daily_syncs: {
        Args: { p_cutoff_hour?: number; p_max_retries?: number }
        Returns: {
          last_error: string
          ledger_id: string
          organization_id: string
          retry_count: number
          status: Database["public"]["Enums"]["daily_sync_status"]
        }[]
      }
      get_user_org_id: { Args: never; Returns: string }
      get_user_organization_id: { Args: never; Returns: string }
      get_work_item_recipients: {
        Args: { p_work_item_id: string }
        Returns: {
          recipient_id: string
        }[]
      }
      get_work_item_recipients_with_admins: {
        Args: { p_work_item_id: string }
        Returns: {
          recipient_id: string
        }[]
      }
      has_active_org_support_grant: {
        Args: { p_admin_id: string; p_org_id: string }
        Returns: boolean
      }
      has_active_support_grant: {
        Args: { p_admin_id: string; p_user_id: string }
        Returns: boolean
      }
      has_business_tier: { Args: { _org_id: string }; Returns: boolean }
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
      insert_notification: {
        Args: {
          p_audience_scope: string
          p_body?: string
          p_category: string
          p_dedupe_key?: string
          p_deep_link?: string
          p_metadata?: Json
          p_severity?: string
          p_title: string
          p_type: string
          p_user_id: string
          p_work_item_id?: string
        }
        Returns: undefined
      }
      is_beta_enrollment_open: { Args: never; Returns: boolean }
      is_business_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_admin: { Args: { org_id: string }; Returns: boolean }
      is_org_member: { Args: { org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_platform_admin_check: { Args: { p_user_id: string }; Returns: boolean }
      is_profile_complete: { Args: { p_user_id: string }; Returns: boolean }
      log_sensitive_access: {
        Args: {
          p_columns?: string[]
          p_context?: string
          p_operation: string
          p_row_count?: number
          p_table_name: string
        }
        Returns: undefined
      }
      notify_work_item_recipients: {
        Args: {
          p_body: string
          p_dedupe_key_prefix: string
          p_deep_link?: string
          p_metadata: Json
          p_severity: string
          p_title: string
          p_type: string
          p_work_item_id: string
        }
        Returns: undefined
      }
      platform_create_courtesy_voucher: {
        Args: {
          p_expires_days?: number
          p_note?: string
          p_recipient_email: string
        }
        Returns: Json
      }
      platform_redeem_voucher: {
        Args: { p_raw_token: string; p_target_org_id?: string }
        Returns: Json
      }
      platform_revoke_voucher: {
        Args: { p_reason?: string; p_voucher_id: string }
        Returns: Json
      }
      platform_rls_probe_negative: { Args: never; Returns: Json }
      platform_verification_snapshot: { Args: never; Returns: Json }
      purge_old_data_access_logs: {
        Args: { p_retention_days?: number }
        Returns: number
      }
      purge_trashed_emails: { Args: never; Returns: number }
      purge_work_item_acts_and_pubs: {
        Args: { p_work_item_id: string }
        Returns: undefined
      }
      purge_work_item_related_data: {
        Args: { p_work_item_id: string }
        Returns: undefined
      }
      record_inference_run: {
        Args: { p_timezone?: string; p_work_item_id: string }
        Returns: boolean
      }
      rpc_insert_notification: {
        Args: {
          p_audience_scope: string
          p_body?: string
          p_category: string
          p_dedupe_key?: string
          p_deep_link?: string
          p_metadata?: Json
          p_severity?: string
          p_title: string
          p_type: string
          p_user_id: string
          p_work_item_id?: string
        }
        Returns: undefined
      }
      rpc_upsert_work_item_acts: { Args: { records: Json }; Returns: Json }
      rpc_upsert_work_item_publicaciones: {
        Args: { records: Json }
        Returns: Json
      }
      safe_jsonb_to_text_array: { Args: { val: Json }; Returns: string[] }
      try_claim_daily_welcome: { Args: { p_user_id: string }; Returns: Json }
      update_daily_sync_ledger: {
        Args: {
          p_error?: string
          p_items_failed?: number
          p_items_succeeded?: number
          p_items_targeted?: number
          p_ledger_id: string
          p_metadata?: Json
          p_status: Database["public"]["Enums"]["daily_sync_status"]
        }
        Returns: undefined
      }
      user_has_accepted_current_terms: {
        Args: { p_user_id: string }
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
      daily_sync_status:
        | "PENDING"
        | "RUNNING"
        | "SUCCESS"
        | "PARTIAL"
        | "FAILED"
        | "BUDGET_OVERFLOW"
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
      notification_audience: "USER" | "ORG_ADMIN" | "SUPER_ADMIN"
      notification_category:
        | "TERMS"
        | "WORK_ITEM_ALERTS"
        | "ORG_ACTIVITY"
        | "OPS_SYNC"
        | "OPS_INCIDENTS"
        | "OPS_E2E"
        | "OPS_WATCHDOG"
        | "OPS_REMEDIATION"
        | "SYSTEM"
      observation_kind:
        | "GATE_FAILURE"
        | "PROVIDER_DEGRADED"
        | "CRON_PARTIAL"
        | "CRON_FAILED"
        | "GHOST_ITEMS"
        | "CLASSIFICATION_ANOMALY"
        | "STUCK_CONVERGENCE"
        | "SYNC_TIMEOUT"
        | "DATA_QUALITY"
        | "HEARTBEAT_OBSERVED"
        | "HEARTBEAT_SKIPPED"
        | "REMEDIATION_ATTEMPTED"
        | "PROVIDER_RECOVERED"
        | "EGRESS_VIOLATION"
        | "SECURITY_ALERT"
        | "PROVIDER_DEGRADED_WIRING"
        | "EXT_FAILURES"
        | "GHOST_ITEMS_WIRING"
        | "ALERT_CREATED"
        | "ADMIN_NOTIFICATION"
        | "DIAGNOSTIC_ESCALATION"
      observation_severity: "INFO" | "WARNING" | "CRITICAL"
      peticion_phase:
        | "PETICION_RADICADA"
        | "CONSTANCIA_RADICACION"
        | "PRORROGA"
        | "RESPUESTA"
      plan_tier: "FREE_TRIAL" | "BASIC" | "PRO" | "ENTERPRISE"
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
      provider_auth_type: "API_KEY" | "HMAC_SHARED_SECRET"
      radicado_verification_status:
        | "NOT_PROVIDED"
        | "PROVIDED_NOT_VERIFIED"
        | "VERIFIED_FOUND"
        | "NOT_FOUND"
        | "LOOKUP_UNAVAILABLE"
        | "AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION"
      reminder_status: "ACTIVE" | "COMPLETED" | "SNOOZED" | "DISMISSED"
      reminder_type:
        | "ACTA_REPARTO_PENDING"
        | "RADICADO_PENDING"
        | "EXPEDIENTE_PENDING"
        | "AUTO_ADMISORIO_PENDING"
      scrape_status:
        | "NOT_ATTEMPTED"
        | "IN_PROGRESS"
        | "SUCCESS"
        | "FAILED"
        | "PARTIAL_SUCCESS"
      stage_change_source:
        | "MANUAL_USER"
        | "SUGGESTION_APPLIED"
        | "SUGGESTION_OVERRIDE"
        | "IMPORT_INITIAL"
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
      work_item_source_scrape_status:
        | "OK"
        | "SCRAPING_PENDING"
        | "EMPTY"
        | "ERROR"
      work_item_source_status: "ACTIVE" | "DISABLED"
      workflow_type:
        | "CGP"
        | "PETICION"
        | "TUTELA"
        | "GOV_PROCEDURE"
        | "CPACA"
        | "LABORAL"
        | "PENAL_906"
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
      daily_sync_status: [
        "PENDING",
        "RUNNING",
        "SUCCESS",
        "PARTIAL",
        "FAILED",
        "BUDGET_OVERFLOW",
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
      notification_audience: ["USER", "ORG_ADMIN", "SUPER_ADMIN"],
      notification_category: [
        "TERMS",
        "WORK_ITEM_ALERTS",
        "ORG_ACTIVITY",
        "OPS_SYNC",
        "OPS_INCIDENTS",
        "OPS_E2E",
        "OPS_WATCHDOG",
        "OPS_REMEDIATION",
        "SYSTEM",
      ],
      observation_kind: [
        "GATE_FAILURE",
        "PROVIDER_DEGRADED",
        "CRON_PARTIAL",
        "CRON_FAILED",
        "GHOST_ITEMS",
        "CLASSIFICATION_ANOMALY",
        "STUCK_CONVERGENCE",
        "SYNC_TIMEOUT",
        "DATA_QUALITY",
        "HEARTBEAT_OBSERVED",
        "HEARTBEAT_SKIPPED",
        "REMEDIATION_ATTEMPTED",
        "PROVIDER_RECOVERED",
        "EGRESS_VIOLATION",
        "SECURITY_ALERT",
        "PROVIDER_DEGRADED_WIRING",
        "EXT_FAILURES",
        "GHOST_ITEMS_WIRING",
        "ALERT_CREATED",
        "ADMIN_NOTIFICATION",
        "DIAGNOSTIC_ESCALATION",
      ],
      observation_severity: ["INFO", "WARNING", "CRITICAL"],
      peticion_phase: [
        "PETICION_RADICADA",
        "CONSTANCIA_RADICACION",
        "PRORROGA",
        "RESPUESTA",
      ],
      plan_tier: ["FREE_TRIAL", "BASIC", "PRO", "ENTERPRISE"],
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
      provider_auth_type: ["API_KEY", "HMAC_SHARED_SECRET"],
      radicado_verification_status: [
        "NOT_PROVIDED",
        "PROVIDED_NOT_VERIFIED",
        "VERIFIED_FOUND",
        "NOT_FOUND",
        "LOOKUP_UNAVAILABLE",
        "AMBIGUOUS_MATCH_NEEDS_USER_CONFIRMATION",
      ],
      reminder_status: ["ACTIVE", "COMPLETED", "SNOOZED", "DISMISSED"],
      reminder_type: [
        "ACTA_REPARTO_PENDING",
        "RADICADO_PENDING",
        "EXPEDIENTE_PENDING",
        "AUTO_ADMISORIO_PENDING",
      ],
      scrape_status: [
        "NOT_ATTEMPTED",
        "IN_PROGRESS",
        "SUCCESS",
        "FAILED",
        "PARTIAL_SUCCESS",
      ],
      stage_change_source: [
        "MANUAL_USER",
        "SUGGESTION_APPLIED",
        "SUGGESTION_OVERRIDE",
        "IMPORT_INITIAL",
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
      work_item_source_scrape_status: [
        "OK",
        "SCRAPING_PENDING",
        "EMPTY",
        "ERROR",
      ],
      work_item_source_status: ["ACTIVE", "DISABLED"],
      workflow_type: [
        "CGP",
        "PETICION",
        "TUTELA",
        "GOV_PROCEDURE",
        "CPACA",
        "LABORAL",
        "PENAL_906",
      ],
    },
  },
} as const
