/**
 * msOAuth.ts — multi-tenant Microsoft OAuth primitives (iteration 39).
 *
 * Andromeda owns ONE multi-tenant Azure app registration. A subscriber never
 * sees a client id or secret: they click "Conectar correo", authenticate on
 * Microsoft's own screen inside their own tenant, and approve the scopes.
 *
 * Everything here is pure except the crypto primitives, so the failure
 * classifier can be unit-tested without network access.
 */

/** Consent requested when the mailbox is first connected. Read-only. */
export const CONNECT_SCOPES = ["Mail.Read", "offline_access", "User.Read"] as const;

/**
 * Incremental consent: Mail.Send is requested only when the user first tries
 * to send from Andromeda, never at connection time.
 */
export const SEND_SCOPES = [...CONNECT_SCOPES, "Mail.Send"] as const;

export function scopesFor(includeSend: boolean): string[] {
  return [...(includeSend ? SEND_SCOPES : CONNECT_SCOPES)];
}

/**
 * Authority used for the authorize/token calls. `common` accepts work/school
 * accounts from ANY directory plus personal Microsoft accounts; `organizations`
 * restricts to work/school. Overridable per environment, never per customer.
 */
export function authorityTenant(): string {
  return Deno.env.get("MS_AUTHORITY_TENANT") || "common";
}

// ------------------------------------------------------------------ PKCE ---

function b64urlBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 verifier: 43–128 chars from the unreserved set. */
export function createPkceVerifier(): string {
  return b64urlBytes(crypto.getRandomValues(new Uint8Array(64)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64urlBytes(new Uint8Array(digest));
}

// ---------------------------------------------------------- failure model ---

export type MsFailureCode =
  | "ADMIN_CONSENT_REQUIRED"
  | "CONDITIONAL_ACCESS"
  | "MFA_REQUIRED"
  | "CONSENT_REVOKED"
  | "PASSWORD_CHANGED"
  | "TOKEN_EXPIRED"
  | "USER_DECLINED"
  | "UNVERIFIED_PUBLISHER"
  | "APP_NOT_MULTITENANT"
  | "TENANT_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

/** Who must act for the connection to work again. */
export type MsResolution = "USER_RECONNECT" | "ADMIN_CONSENT" | "VENDOR_FIX" | "AUTOMATIC";

export interface MsFailure {
  code: MsFailureCode;
  /** Plain-Spanish message telling the user what to do next. */
  message: string;
  /** True when the stored grant is dead and retrying is pointless. */
  terminal: boolean;
  /** The raw AADSTS identifier, kept for support forensics only (never shown). */
  aadsts: string | null;
  /** Who can unblock it. Drives the UI action and prevents useless retries. */
  resolution: MsResolution;
}

/** AADSTS codes are the only reliable discriminator; text is a fallback. */
const RULES: Array<{ code: MsFailureCode; codes: string[]; re?: RegExp }> = [
  {
    // The Andromeda app registration itself is misconfigured (single-tenant
    // while the code authenticates against /common). Only we can fix it.
    code: "APP_NOT_MULTITENANT",
    codes: ["AADSTS50194", "AADSTS700016", "AADSTS50020"],
    re: /not configured as a multi-?tenant application|application with identifier .* was not found/i,
  },
  {
    code: "TENANT_NOT_FOUND",
    codes: ["AADSTS90002"],
    re: /tenant .* not found/i,
  },
  {
    code: "ADMIN_CONSENT_REQUIRED",
    codes: ["AADSTS65001", "AADSTS90094", "AADSTS900941", "AADSTS650056", "AADSTS650057"],
    re: /admin(istrator)?\s+consent|consentimiento del administrador|not authorized to consent/i,
  },
  {
    code: "MFA_REQUIRED",
    codes: ["AADSTS50076", "AADSTS50079", "AADSTS50158"],
    re: /multi-?factor/i,
  },
  {
    code: "CONDITIONAL_ACCESS",
    codes: ["AADSTS53000", "AADSTS53001", "AADSTS53002", "AADSTS53003", "AADSTS53004", "AADSTS50005"],
    re: /conditional access|device is not|compliant/i,
  },
  {
    code: "PASSWORD_CHANGED",
    codes: ["AADSTS50173"],
    re: /password (has been )?changed|credentials.*changed/i,
  },
  {
    code: "CONSENT_REVOKED",
    codes: ["AADSTS65004", "AADSTS70000", "AADSTS700003", "AADSTS90008"],
    re: /invalid_grant|revoked|consent.*(revoked|withdrawn)/i,
  },
  {
    code: "TOKEN_EXPIRED",
    codes: ["AADSTS700082", "AADSTS50078", "AADSTS700084"],
    re: /token.*expired|refresh token has expired/i,
  },
  { code: "USER_DECLINED", codes: ["AADSTS65004"], re: /access_denied|did not consent|user declined/i },
  { code: "UNVERIFIED_PUBLISHER", codes: ["AADSTS500011"], re: /unverified publisher/i },
  {
    // Transport / Microsoft-side outage: never a statement about the grant.
    code: "PROVIDER_UNAVAILABLE",
    codes: ["AADSTS90033"],
    re: /temporarily unavailable|service unavailable|\b(429|500|502|503|504)\b|timed? ?out|network error/i,
  },
];


const MESSAGES: Record<
  MsFailureCode,
  { message: string; terminal: boolean; resolution: MsResolution }
> = {
  APP_NOT_MULTITENANT: {
    message:
      "La conexión con Microsoft está bloqueada por una configuración nuestra, no suya. Ya estamos corrigiéndola; no necesita hacer nada y le avisaremos cuando pueda volver a conectar el buzón.",
    terminal: true,
    resolution: "VENDOR_FIX",
  },
  TENANT_NOT_FOUND: {
    message:
      "Microsoft no reconoció el dominio de correo que intentó conectar. Verifique que está usando su cuenta corporativa de Microsoft 365.",
    terminal: true,
    resolution: "USER_RECONNECT",
  },
  ADMIN_CONSENT_REQUIRED: {
    message:
      "Su organización exige que un administrador autorice las aplicaciones externas. Envíele el enlace de autorización a la persona que administra el correo de su firma; cuando lo apruebe, vuelva a pulsar «Conectar correo».",
    terminal: true,
    resolution: "ADMIN_CONSENT",
  },
  CONDITIONAL_ACCESS: {
    message:
      "Las políticas de acceso de su organización (acceso condicional o dispositivo administrado) bloquearon la conexión. Intente desde un equipo autorizado o pida a su administrador que permita Andromeda.",
    terminal: true,
    resolution: "ADMIN_CONSENT",
  },
  MFA_REQUIRED: {
    message:
      "Microsoft exigió un segundo factor de autenticación que no se completó. Vuelva a intentarlo y confirme la verificación en su teléfono o aplicación autenticadora.",
    terminal: false,
    resolution: "USER_RECONNECT",
  },
  CONSENT_REVOKED: {
    message:
      "El permiso concedido a Andromeda fue revocado por usted o por su administrador. La conexión quedó inactiva y no se seguirá intentando; vuelva a conectar el buzón cuando lo desee.",
    terminal: true,
    resolution: "USER_RECONNECT",
  },
  PASSWORD_CHANGED: {
    message:
      "Su contraseña de Microsoft cambió y eso invalidó el permiso guardado. Vuelva a conectar el buzón; sólo tomará un clic.",
    terminal: true,
    resolution: "USER_RECONNECT",
  },
  TOKEN_EXPIRED: {
    message:
      "El permiso guardado caducó por inactividad. Vuelva a conectar el buzón para reanudar la vinculación de correos.",
    terminal: true,
    resolution: "USER_RECONNECT",
  },
  USER_DECLINED: {
    message: "No se aprobaron los permisos en la pantalla de Microsoft, así que no se conectó ningún buzón.",
    terminal: true,
    resolution: "USER_RECONNECT",
  },
  UNVERIFIED_PUBLISHER: {
    message:
      "Microsoft bloqueó la aplicación por política de editor no verificado en su organización. Pida a su administrador que la autorice.",
    terminal: true,
    resolution: "ADMIN_CONSENT",
  },
  PROVIDER_UNAVAILABLE: {
    message:
      "Microsoft no respondió en este intento. No es un problema de sus permisos: Andromeda reintentará automáticamente.",
    terminal: false,
    resolution: "AUTOMATIC",
  },
  UNKNOWN: {
    message:
      "Microsoft rechazó la conexión. Vuelva a intentarlo; si persiste, escríbanos con la hora exacta del intento.",
    terminal: false,
    resolution: "USER_RECONNECT",
  },
};

/** Extracts the raw AADSTS identifier so support can trace the exact refusal. */
export function extractAadsts(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : JSON.stringify(raw ?? "");
  return (text ?? "").match(/AADSTS\d+/i)?.[0]?.toUpperCase() ?? null;
}

/** Maps any Microsoft error payload to a code, a Spanish message and finality. */
export function classifyMsError(raw: unknown): MsFailure {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : JSON.stringify(raw ?? "");
  const upper = (text ?? "").toUpperCase();
  const aadsts = extractAadsts(text);
  for (const rule of RULES) {
    if (rule.codes.some((c) => upper.includes(c)) || (rule.re && rule.re.test(text ?? ""))) {
      return { code: rule.code, ...MESSAGES[rule.code], aadsts };
    }
  }
  return { code: "UNKNOWN", ...MESSAGES.UNKNOWN, aadsts };
}


/**
 * URL the lawyer forwards to their IT administrator. Consent is granted for the
 * whole tenant, so afterwards every user in the firm can connect in one click.
 */
export function adminConsentUrl(
  clientId: string,
  redirectUri: string,
  tenant = "organizations",
): string {
  const url = new URL(`https://login.microsoftonline.com/${tenant}/adminconsent`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

/** Microsoft's own page where a user removes a previously granted consent. */
export const MS_CONSENT_MANAGEMENT_URL = "https://myapps.microsoft.com/?tenantId=";

/** Reads the `tid` (tenant) claim from an access token without verifying it. */
export function tenantFromToken(accessToken: string): string | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const pad = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
    const claims = JSON.parse(json) as Record<string, unknown>;
    return typeof claims.tid === "string" ? claims.tid : null;
  } catch {
    return null;
  }
}
