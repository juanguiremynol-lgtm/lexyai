/**
 * Platform Page - Entry point for Platform Console
 * Routes to the appropriate tab based on URL
 */

import { useLocation } from "react-router-dom";
import { PlatformConsole } from "@/components/platform";

// Map URL paths to tab values
const pathToTab: Record<string, string> = {
  "/platform": "verification",
  "/platform/metrics": "metrics",
  "/platform/organizations": "organizations",
  "/platform/subscriptions": "subscriptions",
  "/platform/vouchers": "vouchers",
  "/platform/limits": "limits",
  "/platform/support": "impersonation",
  "/platform/users": "users",
  "/platform/audit": "audit",
  "/platform/email-ops": "email-ops",
  "/platform/system": "system",
};

export default function PlatformPage() {
  const location = useLocation();
  const defaultTab = pathToTab[location.pathname] || "verification";
  
  return <PlatformConsole defaultTab={defaultTab} />;
}
