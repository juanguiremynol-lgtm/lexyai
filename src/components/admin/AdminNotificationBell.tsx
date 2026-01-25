/**
 * Admin Notification Bell - Shows unread admin notifications in TopBar
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  ShieldAlert, 
  Bell,
  Check,
  ExternalLink,
  Loader2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export function AdminNotificationBell() {
  const { organization } = useOrganization();
  const { isAdmin, isOwner, isLoading: membershipLoading } = useOrganizationMembership(organization?.id || null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Only show for admins/owners
  const canView = isAdmin || isOwner;

  // Fetch unread count and latest notifications
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["admin-notifications-bell", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];

      const { data, error } = await supabase
        .from("admin_notifications")
        .select("id, type, title, message, is_read, created_at")
        .eq("organization_id", organization.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data || []) as AdminNotification[];
    },
    enabled: !!organization?.id && canView,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Mark as read mutation
  const markAsRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-notifications-bell"] });
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
    },
  });

  // Navigate to admin alerts tab
  const goToAlerts = () => {
    setOpen(false);
    navigate("/settings?tab=admin&adminTab=alerts");
  };

  // Handle notification click
  const handleNotificationClick = (notification: AdminNotification) => {
    markAsRead.mutate(notification.id);
    goToAlerts();
  };

  // Don't render for non-admins
  if (!canView || membershipLoading) {
    return null;
  }

  const unreadCount = notifications?.length || 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative flex-shrink-0"
        >
          <ShieldAlert className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Alertas Admin</h4>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {unreadCount} nuevas
              </Badge>
            )}
          </div>
        </div>
        
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : notifications?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Sin alertas pendientes</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="p-2">
              {notifications?.map((notification) => (
                <button
                  key={notification.id}
                  className="w-full text-left p-3 rounded-lg hover:bg-muted transition-colors mb-1 last:mb-0"
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm line-clamp-1">
                        {notification.title}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: es })}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="p-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={goToAlerts}
          >
            Ver todas las alertas
            <ExternalLink className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
