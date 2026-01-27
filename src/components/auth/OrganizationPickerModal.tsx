/**
 * Organization Picker Modal
 * 
 * Shown when a user belongs to multiple organizations.
 * Allows selecting which organization context to use.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, Check, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OrganizationPickerModalProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

interface OrgMembership {
  id: string;
  role: string;
  organization: {
    id: string;
    name: string;
    slug: string | null;
  };
}

export function OrganizationPickerModal({ 
  open, 
  onClose,
  userId,
}: OrganizationPickerModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Fetch user's organization memberships
  const { data: memberships, isLoading } = useQuery({
    queryKey: ["user-org-memberships", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_memberships")
        .select(`
          id,
          role,
          organization:organizations!inner(id, name, slug)
        `)
        .eq("user_id", userId);
      
      if (error) throw error;
      
      // Transform to flat structure
      return (data || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        organization: m.organization,
      })) as OrgMembership[];
    },
    enabled: open && !!userId,
  });

  // Mutation to update user's active organization
  const selectOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase
        .from("profiles")
        .update({ organization_id: orgId })
        .eq("id", userId);
      
      if (error) throw error;
      return orgId;
    },
    onSuccess: (orgId) => {
      // Invalidate organization context
      queryClient.invalidateQueries({ queryKey: ["current-organization"] });
      toast.success("Organización seleccionada");
      onClose();
      navigate("/app/dashboard");
    },
    onError: (error: Error) => {
      toast.error("Error al seleccionar organización: " + error.message);
    },
  });

  // Auto-select if only one org
  useEffect(() => {
    if (memberships && memberships.length === 1 && open) {
      selectOrgMutation.mutate(memberships[0].organization.id);
    }
  }, [memberships, open]);

  const handleSelect = () => {
    if (selectedOrgId) {
      selectOrgMutation.mutate(selectedOrgId);
    }
  };

  // Don't show modal if only one org (will auto-select)
  if (memberships && memberships.length <= 1) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Selecciona una Organización
          </DialogTitle>
          <DialogDescription>
            Perteneces a múltiples organizaciones. Selecciona con cuál deseas trabajar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {isLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : memberships && memberships.length > 0 ? (
            memberships.map((membership) => (
              <Card 
                key={membership.id}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary/50",
                  selectedOrgId === membership.organization.id && "border-primary bg-primary/5"
                )}
                onClick={() => setSelectedOrgId(membership.organization.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted">
                        <Building2 className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium">{membership.organization.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {membership.role}
                          </Badge>
                          {membership.organization.slug && (
                            <span className="text-xs text-muted-foreground">
                              @{membership.organization.slug}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {selectedOrgId === membership.organization.id && (
                      <Check className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No se encontraron organizaciones</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSelect}
            disabled={!selectedOrgId || selectOrgMutation.isPending}
          >
            {selectOrgMutation.isPending ? "Seleccionando..." : "Continuar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
