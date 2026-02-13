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
  | "prompt_sent";

export function trackMascotEvent(
  event: MascotEvent,
  properties?: Record<string, unknown>
) {
  if (import.meta.env.DEV) {
    console.debug(`[atenia-mascot] ${event}`, properties);
  }
}
