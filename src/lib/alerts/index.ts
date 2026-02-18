/**
 * Alerts module - centralized alert management
 */

export {
  createAlertIdempotent,
  dismissAlert,
  dismissAlerts,
  dismissAllAlerts,
  acknowledgeAlert,
  resolveAlert,
  markAlertsAsRead,
  snoozeAlerts,
  type AlertEntityType,
  type AlertSeverity,
  type AlertStatus,
  type CreateAlertParams,
} from './alert-service';

export {
  createUserAlert,
  ALERT_TYPE_LABELS,
  type UserAlertType,
  type CreateUserAlertParams,
} from './create-user-alert';
