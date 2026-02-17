export type MascotEvent =
  | "mascot_shown"
  | "mascot_clicked"
  | "bubble_shown"
  | "bubble_dismissed"
  | "bubble_action_clicked"
  | "tips_disabled"
  | "quick_prompt_clicked"
  | "chip_clicked"
  | "chat_opened"
  | "chat_closed"
  | "chat_message_sent"
  | "nudge_shown"
  | "recovery_requested"
  | "recovery_completed"
  | "purge_enable_requested"
  | "purge_enabled"
  | "prompt_sent"
  | "atenia_command_detected"
  | "atenia_action_confirmed"
  | "atenia_action_executed"
  | "atenia_action_denied"
  | "ticker_toggle_requested"
  | "invite_user_requested"
  | "remove_user_requested"
  | "role_change_requested"
  | "support_ticket_created"
  | "org_usage_viewed"
  | "analytics_status_viewed"
  | "analytics_config_changed"
  | "external_open";

export function trackMascotEvent(
  event: MascotEvent,
  properties?: Record<string, unknown>
) {
  if (import.meta.env.DEV) {
    console.debug(`[atenia-mascot] ${event}`, properties);
  }
}
