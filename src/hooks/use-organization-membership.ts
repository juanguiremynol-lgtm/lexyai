import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
  updated_at: string;
  user_email?: string;
  user_full_name?: string;
}

/**
 * Hook to manage organization memberships
 */
export function useOrganizationMembership(organizationId: string | null) {
  const queryClient = useQueryClient();

  // Fetch all memberships for the organization
  const { data: memberships, isLoading, refetch } = useQuery({
    queryKey: ['organization-memberships', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from('organization_memberships')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Fetch user details for each membership
      const membershipsWithUsers = await Promise.all(
        (data || []).map(async (m) => {
          // Get user email from auth (admin only in edge function)
          // For now, return membership data only
          return m as OrganizationMembership;
        })
      );

      return membershipsWithUsers;
    },
    enabled: !!organizationId,
  });

  // Get current user's role in the organization
  const { data: currentUserRole } = useQuery({
    queryKey: ['current-user-role', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('organization_memberships')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .single();

      if (error) return null;
      return data?.role as MembershipRole | null;
    },
    enabled: !!organizationId,
  });

  // Add a new member
  const addMember = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: MembershipRole }) => {
      if (!organizationId) throw new Error('No organization selected');

      // First, find the user by email (would need an edge function in production)
      // For now, show an error since we can't look up users by email from client
      throw new Error('La invitación por correo requiere configuración adicional. Por favor contacte soporte.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-memberships', organizationId] });
      toast.success('Miembro agregado exitosamente');
    },
    onError: (error: Error) => {
      toast.error('Error al agregar miembro: ' + error.message);
    },
  });

  // Update member role
  const updateMemberRole = useMutation({
    mutationFn: async ({ membershipId, newRole }: { membershipId: string; newRole: MembershipRole }) => {
      const { error } = await supabase
        .from('organization_memberships')
        .update({ role: newRole })
        .eq('id', membershipId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-memberships', organizationId] });
      toast.success('Rol actualizado');
    },
    onError: (error: Error) => {
      toast.error('Error al actualizar rol: ' + error.message);
    },
  });

  // Remove member
  const removeMember = useMutation({
    mutationFn: async (membershipId: string) => {
      const { error } = await supabase
        .from('organization_memberships')
        .delete()
        .eq('id', membershipId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-memberships', organizationId] });
      toast.success('Miembro removido');
    },
    onError: (error: Error) => {
      toast.error('Error al remover miembro: ' + error.message);
    },
  });

  const isOwner = currentUserRole === 'OWNER';
  const isAdmin = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';

  return {
    memberships: memberships || [],
    isLoading,
    currentUserRole,
    isOwner,
    isAdmin,
    addMember,
    updateMemberRole,
    removeMember,
    refetch,
  };
}
