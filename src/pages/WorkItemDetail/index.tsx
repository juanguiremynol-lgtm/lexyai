// ============= Lines 280-360 of 706 total lines =============

          legacy_peticion_id: peticionData.id,
          legacy_cpaca_id: null,
          legacy_admin_process_id: null,
          created_at: peticionData.created_at,
          updated_at: peticionData.updated_at,
          clients: peticionData.clients,
          matters: null,
          _source: "peticiones",
        } as unknown as WorkItem & { _source: string };
      }
      
      // Removed legacy monitored_processes and cpaca_processes queries
      
      return null;
