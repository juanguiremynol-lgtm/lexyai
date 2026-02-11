import { supabase } from "@/integrations/supabase/client";

/**
 * Count GLOBAL routes that lack an enabled PLATFORM instance
 */
export async function countMissingPlatformInstances(): Promise<number> {
  try {
    // Fetch all GLOBAL routes
    const { data: globalRoutes, error: routesError } = await supabase
      .from("provider_category_routes_global")
      .select("provider_connector_id");

    if (routesError || !globalRoutes) return 0;

    // Get unique connector IDs from GLOBAL routes
    const connectorIds = [...new Set(globalRoutes.map((r: any) => r.provider_connector_id))];

    if (connectorIds.length === 0) return 0;

    // Fetch PLATFORM instances for these connectors
    const { data: platformInstances, error: instancesError } = await supabase
      .from("provider_instances")
      .select("connector_id")
      .eq("scope", "PLATFORM")
      .eq("is_enabled", true)
      .in("connector_id", connectorIds);

    if (instancesError || !platformInstances) {
      return connectorIds.length; // Assume all missing if query fails
    }

    const connectorIdsWithInstances = new Set(
      platformInstances.map((inst: any) => inst.connector_id)
    );

    // Count connectors with GLOBAL routes but no enabled PLATFORM instance
    const missingCount = connectorIds.filter(
      (id) => !connectorIdsWithInstances.has(id)
    ).length;

    return missingCount;
  } catch (err) {
    console.error("[provider-health] Failed to count missing platform instances:", err);
    return 0;
  }
}
