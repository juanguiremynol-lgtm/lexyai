import { supabase } from '@/integrations/supabase/client';
import { extractProfileClaims, getMissingProfileFields } from './oauth-claim-mapper';

const TRIAL_DAYS = 90;

interface OnboardingResult {
  success: boolean;
  organizationId: string | null;
  error?: string;
}

/**
 * Ensures the current user has an organization.
 * If not, creates one with a 90-day trial subscription.
 * Called on first login or when organization is needed.
 */
export async function ensureUserOrganization(): Promise<OnboardingResult> {
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, organizationId: null, error: 'Usuario no autenticado' };
    }

    // Check if user already has an organization via profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.organization_id) {
      // User already has an organization, verify membership exists
      const { data: existingMembership } = await supabase
        .from('organization_memberships')
        .select('id')
        .eq('organization_id', profile.organization_id)
        .eq('user_id', user.id)
        .single();

      if (!existingMembership) {
        // Create membership if missing (migration case)
        await supabase.from('organization_memberships').insert({
          organization_id: profile.organization_id,
          user_id: user.id,
          role: 'OWNER',
        });
      }

      return { success: true, organizationId: profile.organization_id };
    }

    // Check if user has any memberships (might have been invited)
    const { data: memberships } = await supabase
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1);

    if (memberships && memberships.length > 0) {
      // User is member of an org, update their profile
      const orgId = memberships[0].organization_id;
      await supabase
        .from('profiles')
        .update({ organization_id: orgId })
        .eq('id', user.id);

      return { success: true, organizationId: orgId };
    }

    // No organization - create one with trial subscription
    // Use a transaction-like approach
    const orgName = user.user_metadata?.full_name 
      ? `Organización de ${user.user_metadata.full_name}`
      : `Organización ${user.email?.split('@')[0] || 'Nueva'}`;

    // 1. Create personal organization
    const { data: newOrg, error: orgError } = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        created_by: user.id,
        is_active: true,
        type: 'personal',
      })
      .select()
      .single();

    if (orgError || !newOrg) {
      console.error('Error creating organization:', orgError);
      return { success: false, organizationId: null, error: 'Error al crear organización' };
    }

    // 2. Create membership as OWNER
    const { error: membershipError } = await supabase
      .from('organization_memberships')
      .insert({
        organization_id: newOrg.id,
        user_id: user.id,
        role: 'OWNER',
      });

    if (membershipError) {
      console.error('Error creating membership:', membershipError);
      // Cleanup org
      await supabase.from('organizations').delete().eq('id', newOrg.id);
      return { success: false, organizationId: null, error: 'Error al crear membresía' };
    }

    // 3. Create trial subscription
    // Get trial plan
    const { data: trialPlan } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('name', 'trial')
      .single();

    if (trialPlan) {
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);

      await supabase.from('subscriptions').insert({
        organization_id: newOrg.id,
        plan_id: trialPlan.id,
        status: 'trialing',
        trial_started_at: new Date().toISOString(),
        trial_ends_at: trialEndDate.toISOString(),
      });
    }

    // 4. Create default user preferences
    await supabase.from('user_preferences').insert({
      organization_id: newOrg.id,
      user_id: user.id,
      email_alerts_enabled: true,
      ui_alerts_enabled: true,
    });

    // 5. Update profile with organization_id
    await supabase
      .from('profiles')
      .update({ organization_id: newOrg.id })
      .eq('id', user.id);

    return { success: true, organizationId: newOrg.id };
  } catch (error) {
    console.error('Onboarding error:', error);
    return { 
      success: false, 
      organizationId: null, 
      error: error instanceof Error ? error.message : 'Error desconocido' 
    };
  }
}

/**
 * Backfill organization_id for existing data that belongs to the user
 * Called after organization is created/confirmed
 */
export async function backfillOrganizationId(organizationId: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Tables that need organization_id backfill
    const tablesToUpdate = [
      'clients',
      'work_items',
      'work_item_acts',
      'work_item_deadlines',
      'alerts',
      'alert_rules',
      'alert_instances',
      'tasks',
      'process_events',
      'actuaciones',
      'peticiones',
      'cpaca_processes',
      'contracts',
      'icarus_import_runs',
      'hearings',
    ];

    // Update each table where owner_id matches and organization_id is null
    for (const table of tablesToUpdate) {
      try {
        await supabase
          .from(table as any)
          .update({ organization_id: organizationId })
          .eq('owner_id', user.id)
          .is('organization_id', null);
      } catch (e) {
        // Silently continue if table doesn't have the columns
        console.warn(`Could not update ${table}:`, e);
      }
    }
  } catch (error) {
    console.error('Backfill error:', error);
  }
}

/**
 * Auto-populate profile fields from OAuth claims.
 * Only fills empty fields (does not overwrite user-edited data).
 * Returns true if profile is now complete.
 */
export async function autoPopulateProfileFromOAuth(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    // Extract claims from the OAuth provider
    const provider = user.app_metadata?.provider || user.user_metadata?.iss;
    const claims = extractProfileClaims(provider, user.user_metadata);

    // Get current profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, avatar_url, email, address, profile_completed_at')
      .eq('id', user.id)
      .maybeSingle();

    // If profile is already complete, no need to update
    if (profile?.profile_completed_at) return true;

    // Build update object: only fill empty fields
    const updates: Record<string, unknown> = {};

    if (!profile?.full_name && claims.full_name) updates.full_name = claims.full_name;
    if (!profile?.avatar_url && claims.avatar_url) updates.avatar_url = claims.avatar_url;
    if (!profile?.email && (claims.email || user.email)) updates.email = claims.email || user.email;

    // Determine auth provider
    if (provider) updates.auth_provider = provider;

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);
    }

    // Check if profile is now complete (all required fields present)
    const finalName = (updates.full_name as string) || profile?.full_name;
    const finalAvatar = (updates.avatar_url as string) || profile?.avatar_url;
    const finalAddress = profile?.address;

    return !!(finalName && finalAvatar && finalAddress);
  } catch (error) {
    console.error('Auto-populate profile error:', error);
    return false;
  }
}
