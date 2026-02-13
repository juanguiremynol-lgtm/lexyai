/**
 * Platform Billing Page — Super Admin billing console with sub-navigation
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  CreditCard,
  Tag,
  Ticket,
  Crown,
  Receipt,
  AlertTriangle,
  ShieldAlert,
  Settings,
  FileSpreadsheet,
} from "lucide-react";
import { BillingOverviewSection } from "@/components/platform/billing/BillingOverviewSection";
import { BillingGatewaySection } from "@/components/platform/billing/BillingGatewaySection";
import { BillingPlansSection } from "@/components/platform/billing/BillingPlansSection";
import { BillingDiscountsSection } from "@/components/platform/billing/BillingDiscountsSection";
import { BillingSubscriptionsSection } from "@/components/platform/billing/BillingSubscriptionsSection";
import { BillingTransactionsSection } from "@/components/platform/billing/BillingTransactionsSection";
import { BillingDunningSection } from "@/components/platform/billing/BillingDunningSection";
import { BillingFraudSection } from "@/components/platform/billing/BillingFraudSection";
import { BillingSettingsSection } from "@/components/platform/billing/BillingSettingsSection";
import { BillingAccountingSection } from "@/components/platform/billing/BillingAccountingSection";

const billingSubPages = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "gateway", label: "Pasarela (Wompi)", icon: CreditCard },
  { id: "plans", label: "Planes y Precios", icon: Tag },
  { id: "discounts", label: "Descuentos y Vouchers", icon: Ticket },
  { id: "subscriptions", label: "Suscripciones", icon: Crown },
  { id: "transactions", label: "Transacciones", icon: Receipt },
  { id: "dunning", label: "Cobros y Morosidad", icon: AlertTriangle },
  { id: "fraud", label: "Fraude y Verificación", icon: ShieldAlert },
  { id: "settings", label: "Configuración", icon: Settings },
  { id: "accounting", label: "Contabilidad", icon: FileSpreadsheet },
] as const;

type BillingSubPage = (typeof billingSubPages)[number]["id"];

export default function PlatformBillingPage() {
  const [activeSection, setActiveSection] = useState<BillingSubPage>("overview");

  return (
    <div className="flex gap-6 min-h-[calc(100vh-8rem)]">
      {/* Left sidebar submenu */}
      <nav className="w-56 shrink-0 space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-amber-500/70 px-3 py-2">
          Facturación
        </h2>
        {billingSubPages.map((page) => {
          const active = activeSection === page.id;
          return (
            <button
              key={page.id}
              onClick={() => setActiveSection(page.id)}
              className={cn(
                "flex items-center gap-2.5 w-full px-3 py-2 text-sm rounded-lg transition-all duration-200",
                active
                  ? "bg-amber-500/15 text-amber-400 border-l-2 border-amber-500 font-medium"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              )}
            >
              <page.icon className={cn("h-4 w-4 shrink-0", active ? "text-amber-400" : "text-slate-500")} />
              {page.label}
            </button>
          );
        })}
      </nav>

      {/* Content area */}
      <div className="flex-1 min-w-0">
        {activeSection === "overview" && <BillingOverviewSection />}
        {activeSection === "gateway" && <BillingGatewaySection />}
        {activeSection === "plans" && <BillingPlansSection />}
        {activeSection === "discounts" && <BillingDiscountsSection />}
        {activeSection === "subscriptions" && <BillingSubscriptionsSection />}
        {activeSection === "transactions" && <BillingTransactionsSection />}
        {activeSection === "dunning" && <BillingDunningSection />}
        {activeSection === "fraud" && <BillingFraudSection />}
        {activeSection === "settings" && <BillingSettingsSection />}
        {activeSection === "accounting" && <BillingAccountingSection />}
      </div>
    </div>
  );
}
