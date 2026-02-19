-- Add BUDGET_OVERFLOW to daily_sync_status enum
ALTER TYPE public.daily_sync_status ADD VALUE IF NOT EXISTS 'BUDGET_OVERFLOW';
