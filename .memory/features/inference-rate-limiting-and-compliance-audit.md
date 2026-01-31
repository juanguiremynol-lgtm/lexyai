# Memory: features/inference-rate-limiting-and-compliance-audit
Updated: just now

## Inference System Hardening

The inference system has been refactored to ensure:

1. **No Auto-Apply**: Stage suggestions are NEVER applied automatically regardless of confidence level. All suggestions are created with status='PENDING' and require explicit user confirmation via the UI.

2. **Daily Rate Limiting**: Inference suggestion generation is rate-limited to once per work_item per day (in America/Bogota timezone). The `last_inference_date` column on `work_items` tracks when inference last ran. Database functions `check_inference_rate_limit()` and `record_inference_run()` enforce this constraint.

3. **Inference Disable Per Item**: Users can disable inference for specific work items via `stage_inference_enabled=false` on `work_items`. When disabled, no suggestions are generated during sync.

## Compliance Audit Trail

All stage changes are logged to `work_item_stage_audit` table with:

- `change_source`: Distinguishes between:
  - `MANUAL_USER`: Direct user change without suggestion
  - `SUGGESTION_APPLIED`: User accepted system suggestion
  - `SUGGESTION_OVERRIDE`: User chose different stage when reviewing suggestion
  - `IMPORT_INITIAL`: Initial stage set during import

- `suggestion_id` and `suggestion_confidence`: Links to the original suggestion when applicable

- `actor_user_id`: The user who made the change

- Forensic metadata: IP address, user agent, timestamps

The `StageAuditHistory` component provides a visual audit trail in the UI for compliance verification. The `StageAuditBadge` shows the source of the last stage change inline.

## Frontend Integration

The `useStageSuggestion` hook now:
- Creates audit records for all apply/override actions
- Updates `work_items` with change tracking columns
- Records the applying user ID on the suggestion record

## Key Files

- `supabase/functions/sync-by-work-item/index.ts`: Rate limiting and PENDING-only creation
- `src/lib/stage-audit.ts`: Audit library with type definitions
- `src/hooks/useStageSuggestion.ts`: Hook with audit integration
- `src/components/work-items/StageAuditHistory.tsx`: Compliance viewer
