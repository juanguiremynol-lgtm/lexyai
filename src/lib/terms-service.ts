/**
 * Terms & Conditions service — handles acceptance, validation, and version checks.
 * 
 * CANONICAL SOURCE: All terms text and hashes come from the DATABASE via get_active_terms().
 * The frontend file terms-text.ts is a DEV-ONLY fallback and must never be used
 * as the compliance source of truth.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  TERMS_FULL_TEXT as FALLBACK_TERMS_TEXT,
  TERMS_VERSION as FALLBACK_VERSION,
  TERMS_LAST_UPDATED as FALLBACK_DATE,
  PRIVACY_POLICY_VERSION as FALLBACK_PP_VERSION,
  OPERADOR as FALLBACK_OPERADOR,
} from "./terms-text";

export interface ActiveTermsData {
  termsVersion: string;
  termsLastUpdated: string;
  termsText: string;
  termsTextHash: string;
  privacyVersion: string;
  privacyText: string;
  privacyTextHash: string;
  operador: {
    razonSocial: string;
    nit: string;
    domicilio: string;
    correo: string;
    correoPrivacidad: string;
    telefono: string;
  };
}

/**
 * Fetch the active terms and privacy policy text from the DB (canonical source).
 * Falls back to the dev-only terms-text.ts if DB is unreachable.
 */
export async function fetchActiveTerms(): Promise<ActiveTermsData> {
  try {
    const { data, error } = await supabase.rpc("get_active_terms");
    
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      console.warn("Could not fetch terms from DB, using dev fallback:", error?.message);
      return getDevFallback();
    }

    const row = Array.isArray(data) ? data[0] : data;
    
    return {
      termsVersion: row.terms_version,
      termsLastUpdated: row.terms_last_updated,
      termsText: row.terms_text,
      termsTextHash: row.terms_text_hash,
      privacyVersion: row.privacy_version,
      privacyText: row.privacy_text,
      privacyTextHash: row.privacy_text_hash,
      operador: {
        razonSocial: row.operador_razon_social,
        nit: row.operador_nit,
        domicilio: row.operador_domicilio,
        correo: row.operador_correo,
        correoPrivacidad: row.operador_correo_privacidad,
        telefono: row.operador_telefono,
      },
    };
  } catch (err) {
    console.warn("Terms fetch exception, using dev fallback:", err);
    return getDevFallback();
  }
}

function getDevFallback(): ActiveTermsData {
  return {
    termsVersion: FALLBACK_VERSION,
    termsLastUpdated: FALLBACK_DATE,
    termsText: FALLBACK_TERMS_TEXT,
    termsTextHash: "dev-fallback-no-hash",
    privacyVersion: FALLBACK_PP_VERSION,
    privacyText: FALLBACK_TERMS_TEXT,
    privacyTextHash: "dev-fallback-no-hash",
    operador: {
      razonSocial: FALLBACK_OPERADOR.razonSocial,
      nit: FALLBACK_OPERADOR.nit,
      domicilio: FALLBACK_OPERADOR.domicilio,
      correo: FALLBACK_OPERADOR.correoGeneral,
      correoPrivacidad: FALLBACK_OPERADOR.correoPrivacidad,
      telefono: FALLBACK_OPERADOR.telefono,
    },
  };
}

export interface TermsAcceptancePayload {
  checkboxTerms: boolean;
  checkboxAge: boolean;
  checkboxMarketing: boolean;
  acceptanceMethod?: string;
  scrollGated?: boolean;
}

/**
 * Record the user's acceptance of the current terms version.
 * Uses server-derived hashes from the DB — never client-computed hashes.
 */
export async function recordTermsAcceptance(
  payload: TermsAcceptancePayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return { success: false, error: "Usuario no autenticado" };

    // Validate mandatory checkboxes
    if (!payload.checkboxTerms || !payload.checkboxAge) {
      return {
        success: false,
        error: "Debe aceptar los términos obligatorios",
      };
    }

    // Fetch canonical terms data from DB
    const activeTerms = await fetchActiveTerms();

    const { error } = await supabase.from("terms_acceptance").insert({
      user_id: user.id,
      operador_razon_social: activeTerms.operador.razonSocial,
      operador_nit: activeTerms.operador.nit,
      terms_version: activeTerms.termsVersion,
      terms_last_updated_date: activeTerms.termsLastUpdated,
      terms_text_hash: activeTerms.termsTextHash,
      privacy_policy_version: activeTerms.privacyVersion,
      privacy_policy_text_hash: activeTerms.privacyTextHash,
      acceptance_method: payload.acceptanceMethod || "registration_web",
      user_agent: navigator.userAgent,
      locale: navigator.language || "es-CO",
      checkbox_terms: payload.checkboxTerms,
      checkbox_age: payload.checkboxAge,
      checkbox_marketing: payload.checkboxMarketing,
      scroll_gated: payload.scrollGated ?? true,
    });

    if (error) {
      console.error("Terms acceptance insert error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Terms acceptance error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

/**
 * Check if the current user has accepted the currently active terms version.
 * Uses the server-side function for consistency.
 */
export async function hasAcceptedCurrentTerms(): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    // Use the server-side function for authoritative check
    const { data, error } = await supabase.rpc("user_has_accepted_current_terms", {
      p_user_id: user.id,
    });

    if (error) {
      console.error("Terms acceptance check error:", error);
      // Fallback to direct query
      return fallbackCheck(user.id);
    }

    return !!data;
  } catch {
    return false;
  }
}

async function fallbackCheck(userId: string): Promise<boolean> {
  const { data: activeTerms } = await supabase
    .from("terms_versions")
    .select("version")
    .eq("active", true)
    .maybeSingle();

  if (!activeTerms) return true;

  const { data: acceptance } = await supabase
    .from("terms_acceptance")
    .select("id")
    .eq("user_id", userId)
    .eq("terms_version", activeTerms.version)
    .eq("checkbox_terms", true)
    .eq("checkbox_age", true)
    .limit(1)
    .maybeSingle();

  return !!acceptance;
}

/**
 * Get user's acceptance history (for Settings > Legal)
 * Returns ONLY summary data — no IP/user_agent (data minimization)
 */
export async function getUserAcceptanceHistory() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("terms_acceptance")
    .select("id, terms_version, privacy_policy_version, accepted_at, acceptance_method, checkbox_terms, checkbox_age, checkbox_marketing")
    .eq("user_id", user.id)
    .order("accepted_at", { ascending: false });

  return data || [];
}
