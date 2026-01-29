# Memory: features/persistent-stage-suggestions-ui-and-workflow
Updated: just now

Stage suggestions from inference orchestrator are persisted in work_item_stage_suggestions table with confidence levels. ALL suggestions now require explicit user approval via confirmation dialogs (no auto-apply regardless of confidence). Each dialog includes a checkbox to disable future inference for that specific work item (sets work_items.stage_inference_enabled = false). The StageSuggestionBannerDB displays the suggestion with Apply/Dismiss/Override actions, each opening a confirmation dialog with the disable option. This ensures that algorithmic stage changes never override manual legal oversight without explicit consent.
