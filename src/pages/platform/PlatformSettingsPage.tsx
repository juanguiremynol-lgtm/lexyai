/**
 * Platform Settings Page - Super Admin exclusive settings
 */

import { PlatformAdminAlertEmailSettings } from "@/components/settings/PlatformAdminAlertEmailSettings";

export default function PlatformSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white font-mono tracking-wide">Configuración de Plataforma</h2>
        <p className="text-sm text-white/50 mt-1">Ajustes exclusivos del Super Admin</p>
      </div>
      <PlatformAdminAlertEmailSettings />
    </div>
  );
}
