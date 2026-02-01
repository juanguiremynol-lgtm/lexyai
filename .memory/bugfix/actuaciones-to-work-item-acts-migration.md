# Memory: bugfix/actuaciones-to-work-item-acts-migration
Updated: 2026-02-01

## Root Cause Analysis

The data pipeline had 3 critical bugs causing data to be inserted into wrong tables:

1. **Bug #1 - Wrong Target Table (ROOT CAUSE)**: 
   - `sync-by-work-item` was inserting actuaciones into legacy `actuaciones` table
   - The UI reads from `work_item_acts` table
   - Data was being fetched and stored correctly, just in the wrong place

2. **Bug #2 - Publicaciones Infinite Loop**: 
   - Already fixed in `sync-publicaciones-by-work-item` with polling strategy

3. **Bug #3 - Same issue for scheduled-crawler and scraping-service.ts**

## Fix Applied

Changed all INSERT targets from legacy `actuaciones` table to canonical `work_item_acts` table:

### Files Modified:

1. **`supabase/functions/sync-by-work-item/index.ts`** (lines 2839-2883):
   - Changed `.from('actuaciones')` to `.from('work_item_acts')`
   - Updated field mapping to match `work_item_acts` schema:
     - `description` (not `raw_text`)
     - `event_summary` (not `normalized_text`)
     - `source_platform` (not `adapter_name`)
     - `workflow_type` (new required field)
     - `scrape_date` (new required field)
     - `raw_data` JSON for legacy fields

2. **`supabase/functions/scheduled-crawler/index.ts`** (lines 251-310, 345-440):
   - Changed `ActuacionRow` interface to `WorkItemActRow`
   - Updated INSERT to use `work_item_acts` table
   - Updated alert payload to use new field names

3. **`src/lib/scraping/scraping-service.ts`** (lines 257-301):
   - Changed SELECT from `actuaciones` to `work_item_acts` for deduplication
   - Changed INSERT to `work_item_acts` with correct schema mapping

## Canonical Tables

The work_items system uses these canonical tables:

| Purpose | Canonical Table | Legacy Table (DO NOT USE) |
|---------|-----------------|---------------------------|
| Actuaciones/Acts | `work_item_acts` | `actuaciones` |
| Publications/Estados | `work_item_publicaciones` | - |
| Deadlines | `work_item_deadlines` | `cgp_deadlines` |
| Milestones | `cgp_milestones` | (still used) |

## Schema Mapping

| `actuaciones` field | `work_item_acts` field |
|---------------------|------------------------|
| `raw_text` | `description` |
| `normalized_text` | `event_summary` |
| `adapter_name` | `source_platform` |
| `act_type_guess` | `act_type` |
| `filing_id` | ❌ Not used |
| `monitored_process_id` | ❌ Not used |
| - | `workflow_type` (NEW, required) |
| - | `scrape_date` (NEW) |
| - | `raw_data` (JSON for extras) |

## Verification

After deploying, verify data flows correctly:
1. Trigger manual sync on a work item
2. Check `work_item_acts` table for new records
3. Verify UI "Estados" tab shows the data
