import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { NewFilingDialog } from "@/components/filings/NewFilingDialog";

export function AppLayout() {
  const navigate = useNavigate();
  const [showNewFilingDialog, setShowNewFilingDialog] = useState(false);

  const handleNewFiling = () => {
    setShowNewFilingDialog(true);
  };

  const handleFilingCreated = (filingId: string) => {
    setShowNewFilingDialog(false);
    navigate(`/filings/${filingId}`);
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col">
          <TopBar onNewFiling={handleNewFiling} />
          <main className="flex-1 overflow-auto bg-background p-4 lg:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>

      <NewFilingDialog
        open={showNewFilingDialog}
        onOpenChange={setShowNewFilingDialog}
        onSuccess={handleFilingCreated}
      />
    </SidebarProvider>
  );
}
