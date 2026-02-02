/**
 * Super Debug Console
 * 
 * Unified debugging interface consolidating all debug functionality:
 * - Integration status (secrets, provider health)
 * - API testing (single provider)
 * - Full sync pipeline debug
 * - History (sync runs, audit)
 * - Email gateway status
 * - Master Sync (super admin only)
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePlatformAdmin } from '@/hooks/use-platform-admin';
import { 
  Wifi, 
  Search, 
  RefreshCw, 
  History, 
  Mail, 
  Zap,
  Settings,
  Shield,
  Loader2,
} from 'lucide-react';

// Import tab components
import { IntegrationTab } from './tabs/IntegrationTab';
import { ApiTestTab } from './tabs/ApiTestTab';
import { FullSyncTab } from './tabs/FullSyncTab';
import { HistoryTab } from './tabs/HistoryTab';
import { EmailTab } from './tabs/EmailTab';
import { MasterSyncTab } from './tabs/MasterSyncTab';

export function SuperDebugConsole() {
  const { isPlatformAdmin, isLoading, role } = usePlatformAdmin();
  const [activeTab, setActiveTab] = useState('integration');
  
  // Super admin check for master sync tab
  const isSuperAdmin = role === 'SUPER_ADMIN' || isPlatformAdmin; // Allow all platform admins for now

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <Shield className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">Acceso restringido a administradores de plataforma</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="border-b border-border/50 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Settings className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Super Debug Console</CardTitle>
              <CardDescription>
                Diagnóstico completo del pipeline de sincronización
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30">
            <Shield className="h-3 w-3 mr-1" />
            Super Admin
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="border-b border-border/50 px-4 py-2 bg-muted/20">
            <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
              <TabsTrigger 
                value="integration" 
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <Wifi className="h-4 w-4 mr-1.5" />
                Integración
              </TabsTrigger>
              <TabsTrigger 
                value="api-test"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <Search className="h-4 w-4 mr-1.5" />
                Probar API
              </TabsTrigger>
              <TabsTrigger 
                value="full-sync"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Sync Completo
              </TabsTrigger>
              <TabsTrigger 
                value="history"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <History className="h-4 w-4 mr-1.5" />
                Historial
              </TabsTrigger>
              <TabsTrigger 
                value="email"
                className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary"
              >
                <Mail className="h-4 w-4 mr-1.5" />
                Email
              </TabsTrigger>
              {isSuperAdmin && (
                <TabsTrigger 
                  value="master-sync"
                  className="data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-700"
                >
                  <Zap className="h-4 w-4 mr-1.5" />
                  Master Sync
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <div className="p-4">
            <TabsContent value="integration" className="mt-0">
              <IntegrationTab />
            </TabsContent>
            
            <TabsContent value="api-test" className="mt-0">
              <ApiTestTab />
            </TabsContent>
            
            <TabsContent value="full-sync" className="mt-0">
              <FullSyncTab />
            </TabsContent>
            
            <TabsContent value="history" className="mt-0">
              <HistoryTab />
            </TabsContent>
            
            <TabsContent value="email" className="mt-0">
              <EmailTab />
            </TabsContent>
            
            {isSuperAdmin && (
              <TabsContent value="master-sync" className="mt-0">
                <MasterSyncTab />
              </TabsContent>
            )}
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
