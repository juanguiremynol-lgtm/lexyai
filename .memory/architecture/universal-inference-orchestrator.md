# Memory: architecture/universal-inference-orchestrator
Updated: just now

The system implements a unified 'inference-orchestrator' that standardizes workflow and stage detection across all ingestion sources (ESTADOS, CPNU, SAMAI, Tutelas, Publicaciones). It accepts normalized events with source_type ('ESTADO', 'ACTUACION', 'PUBLICACION', 'TUTELA_EXPEDIENTE') and delegates to specialized classifiers (estado-stage-inference, cpaca-stage-inference, penal906-classifier) based on workflow_type. High-confidence suggestions (>= 0.8) auto-apply; lower confidence creates persistent PENDING records in work_item_stage_suggestions for UI review. This eliminates duplicated inference logic across ingestion paths.
