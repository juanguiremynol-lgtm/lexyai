/**
 * email-connection-failures — Presentation layer for the Microsoft failure
 * codes classified server-side in supabase/functions/_shared/msOAuth.ts.
 *
 * The codes are the contract; the copy lives here so the UI can explain what
 * happened and what the lawyer must do next, in plain Spanish and without any
 * Microsoft error number leaking to the screen.
 */
export type EmailFailureCode =
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

export interface FailurePresentation {
  title: string;
  detail: string;
  /** What the user can do from this screen. */
  action: "RECONNECT" | "ADMIN_CONSENT" | "NONE";
  actionLabel: string;
}


const PRESENTATION: Record<EmailFailureCode, FailurePresentation> = {
  ADMIN_CONSENT_REQUIRED: {
    title: "Su organización debe autorizar Andromeda",
    detail:
      "El correo de su firma está configurado para que sólo un administrador autorice aplicaciones externas. Comparta el enlace de autorización con quien administra el correo; basta con que lo apruebe una vez para toda la firma.",
    action: "ADMIN_CONSENT",
    actionLabel: "Obtener enlace para el administrador",
  },
  CONDITIONAL_ACCESS: {
    title: "Las políticas de su organización bloquearon la conexión",
    detail:
      "Su empresa exige conectarse desde un equipo o una red autorizada. Inténtelo desde un equipo corporativo o pida a su administrador que permita Andromeda.",
    action: "RECONNECT",
    actionLabel: "Reintentar conexión",
  },
  MFA_REQUIRED: {
    title: "Faltó la verificación en dos pasos",
    detail:
      "Microsoft pidió un segundo factor que no se completó. Vuelva a intentarlo y confirme la verificación en su teléfono o aplicación autenticadora.",
    action: "RECONNECT",
    actionLabel: "Reintentar conexión",
  },
  CONSENT_REVOKED: {
    title: "El permiso fue revocado",
    detail:
      "Usted o su administrador retiraron el permiso concedido a Andromeda. La conexión quedó inactiva y no se sigue intentando. Sus correos ya vinculados se conservan.",
    action: "RECONNECT",
    actionLabel: "Volver a conectar",
  },
  PASSWORD_CHANGED: {
    title: "Su contraseña de Microsoft cambió",
    detail:
      "El cambio de contraseña invalidó el permiso guardado. Volver a conectar el buzón toma un clic.",
    action: "RECONNECT",
    actionLabel: "Volver a conectar",
  },
  TOKEN_EXPIRED: {
    title: "El permiso caducó por inactividad",
    detail:
      "Microsoft caduca los permisos que no se usan durante un tiempo prolongado. Vuelva a conectar el buzón para reanudar la vinculación de correos.",
    action: "RECONNECT",
    actionLabel: "Volver a conectar",
  },
  USER_DECLINED: {
    title: "No se aprobaron los permisos",
    detail:
      "En la pantalla de Microsoft no se otorgó el acceso, así que no se conectó ningún buzón y no se leyó ningún correo.",
    action: "RECONNECT",
    actionLabel: "Conectar correo",
  },
  UNVERIFIED_PUBLISHER: {
    title: "Microsoft pidió verificar al editor de la aplicación",
    detail:
      "Su organización sólo admite aplicaciones de editores verificados. Estamos completando esa verificación con Microsoft; mientras tanto, su administrador puede autorizar Andromeda manualmente.",
    action: "ADMIN_CONSENT",
    actionLabel: "Obtener enlace para el administrador",
  },
  UNKNOWN: {
    title: "No se pudo mantener la conexión con su correo",
    detail:
      "Microsoft rechazó el acceso por un motivo que no pudimos clasificar. Vuelva a conectar el buzón; si el problema persiste, escríbanos y lo revisamos.",
    action: "RECONNECT",
    actionLabel: "Volver a conectar",
  },
};

export function presentFailure(code: string | null | undefined): FailurePresentation | null {
  if (!code) return null;
  return PRESENTATION[(code as EmailFailureCode)] ?? PRESENTATION.UNKNOWN;
}
