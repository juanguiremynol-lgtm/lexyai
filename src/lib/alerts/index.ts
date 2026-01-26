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
  type AlertEntityType,
  type AlertSeverity,
  type AlertStatus,
  type CreateAlertParams,
} from './alert-service';
