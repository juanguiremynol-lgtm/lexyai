/**
 * Platform Vouchers Tab - Create and manage courtesy vouchers
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Gift } from "lucide-react";
import { CourtesyVoucherDialog, VoucherList } from "./vouchers";

export function PlatformVouchersTab() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Create Voucher Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Crear Voucher
          </CardTitle>
          <CardDescription>
            Genere vouchers de cortesía para otorgar acceso Enterprise gratuito
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Crear Voucher de Cortesía
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Enterprise por 1 año • COP $0 (IVA incluido)
          </p>
        </CardContent>
      </Card>

      {/* Voucher List */}
      <VoucherList />

      {/* Create Dialog */}
      <CourtesyVoucherDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
