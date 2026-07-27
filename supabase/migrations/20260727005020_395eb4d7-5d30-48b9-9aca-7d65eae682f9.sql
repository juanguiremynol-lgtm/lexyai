UPDATE public.provider_connectors
SET is_enabled = false,
    description = COALESCE(NULLIF(description, ''), 'Plantilla genérica de conector ATENIA v1.')
      || ' [DESACTIVADO 2026-07-27] Plantilla sin instancias activas: hacía fallar cada pre-vuelo con "No active provider instance configured". Reactivar solo cuando exista una provider_instances habilitada apuntando a un backend real.',
    updated_at = now()
WHERE key = 'generic_atenia_v1';