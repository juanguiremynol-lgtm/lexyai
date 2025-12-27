// Subscription plan types and constants

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export type PlanName = 'trial' | 'basic' | 'standard' | 'unlimited';

export interface SubscriptionPlan {
  id: string;
  name: PlanName;
  display_name: string;
  price_cop: number;
  max_clients: number | null;
  max_filings: number | null;
  trial_days: number;
  features: string[];
  active: boolean;
}

export interface Subscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
  plan?: SubscriptionPlan;
}

export interface UsageLimits {
  maxClients: number | null;
  maxFilings: number | null;
  currentClients: number;
  currentFilings: number;
  canAddClient: boolean;
  canAddFiling: boolean;
  clientsRemaining: number | null;
  filingsRemaining: number | null;
  usagePercentClients: number;
  usagePercentFilings: number;
}

export const PLAN_COLORS: Record<PlanName, string> = {
  trial: 'bg-muted text-muted-foreground',
  basic: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  standard: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  unlimited: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Período de prueba',
  active: 'Activa',
  past_due: 'Pago pendiente',
  canceled: 'Cancelada',
  expired: 'Expirada',
};

export const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  past_due: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  canceled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  expired: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getDaysRemaining(endDate: string | null): number {
  if (!endDate) return 0;
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}
