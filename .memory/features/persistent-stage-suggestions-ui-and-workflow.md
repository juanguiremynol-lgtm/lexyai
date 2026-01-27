# Memory: features/persistent-stage-suggestions-ui-and-workflow
Updated: just now

Stage suggestions from inference orchestrator are persisted in work_item_stage_suggestions table with confidence levels. High-confidence (>= 0.8) auto-apply to work_items.stage; lower confidence creates PENDING records. WorkItemDetail displays StageSuggestionBanner with suggested stage, confidence, reason, and Apply/Dismiss/Override actions. User review prevents unintended automatic stage changes while expediting high-confidence updates.
