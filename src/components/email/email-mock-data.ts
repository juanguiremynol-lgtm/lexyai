import type { MockEmail } from "./email-client-types";

const PLATFORM_EMAIL = "info@andromeda.legal";

export const MOCK_EMAILS: MockEmail[] = [
  {
    id: "1",
    folder: "inbox",
    from: { name: "Carlos Pérez", email: "carlos@ejemplo.com" },
    to: [PLATFORM_EMAIL],
    subject: "Actualización del expediente 2024-00512",
    preview: "Buenos días, le informo que el juzgado ha emitido un nuevo auto en el expediente...",
    htmlBody: `<div style="font-family: sans-serif;">
      <p>Buenos días,</p>
      <p>Le informo que el juzgado ha emitido un nuevo auto en el expediente <strong>2024-00512</strong>. Se requiere respuesta antes del viernes.</p>
      <p>Adjunto el documento para su revisión.</p>
      <p>Saludos cordiales,<br/>Carlos Pérez<br/>Abogado asociado</p>
    </div>`,
    date: "2026-02-17T09:30:00Z",
    isRead: false,
    hasAttachments: true,
    attachments: [{ name: "auto_2024-00512.pdf", size: "245 KB" }],
  },
  {
    id: "2",
    folder: "inbox",
    from: { name: "María López", email: "maria.lopez@tribunal.gov.co" },
    to: [PLATFORM_EMAIL],
    subject: "Notificación de audiencia programada",
    preview: "Se le notifica que la audiencia del proceso No. 2023-08891 ha sido programada...",
    htmlBody: `<div style="font-family: sans-serif;">
      <p>Estimado usuario,</p>
      <p>Se le notifica que la audiencia del proceso <strong>No. 2023-08891</strong> ha sido programada para el día <strong>25 de febrero de 2026</strong> a las 10:00 AM.</p>
      <p>Atentamente,<br/>Secretaría del Tribunal</p>
    </div>`,
    date: "2026-02-17T08:15:00Z",
    isRead: false,
    hasAttachments: false,
  },
  {
    id: "3",
    folder: "inbox",
    from: { name: "Soporte Andromeda", email: "soporte@andromeda.legal" },
    to: [PLATFORM_EMAIL],
    subject: "Tu suscripción ha sido renovada",
    preview: "Tu plan Business ha sido renovado exitosamente por un período de 30 días...",
    htmlBody: `<div style="font-family: sans-serif;">
      <p>Hola,</p>
      <p>Tu plan <strong>Business</strong> ha sido renovado exitosamente hasta el <strong>17 de marzo de 2026</strong>.</p>
      <p>Gracias por confiar en Andromeda.</p>
    </div>`,
    date: "2026-02-16T14:00:00Z",
    isRead: true,
    hasAttachments: false,
  },
  {
    id: "4",
    folder: "inbox",
    from: { name: "Juan Rodríguez", email: "j.rodriguez@bufete.co" },
    to: [PLATFORM_EMAIL],
    cc: ["contabilidad@bufete.co"],
    subject: "Re: Factura pendiente - Caso Martínez",
    preview: "Adjunto la factura corregida según lo acordado en nuestra última reunión...",
    htmlBody: `<div style="font-family: sans-serif;">
      <p>Estimados,</p>
      <p>Adjunto la factura corregida según lo acordado. El monto total es de <strong>$3,500,000 COP</strong>.</p>
      <p>Quedo atento a su confirmación de pago.</p>
      <p>Juan Rodríguez</p>
    </div>`,
    date: "2026-02-15T16:45:00Z",
    isRead: true,
    hasAttachments: true,
    attachments: [{ name: "factura_martinez_v2.pdf", size: "128 KB" }],
  },
  {
    id: "5",
    folder: "sent",
    from: { name: "Andromeda Legal", email: PLATFORM_EMAIL },
    to: ["carlos@ejemplo.com"],
    subject: "Re: Actualización del expediente 2024-00512",
    preview: "Gracias Carlos, revisaremos el documento y te confirmaremos...",
    htmlBody: `<div style="font-family: sans-serif;"><p>Gracias Carlos, revisaremos el documento y te confirmaremos a la brevedad.</p></div>`,
    date: "2026-02-17T10:00:00Z",
    isRead: true,
    hasAttachments: false,
  },
  {
    id: "6",
    folder: "drafts",
    from: { name: "Andromeda Legal", email: PLATFORM_EMAIL },
    to: ["tribunal@rama.gov.co"],
    subject: "Solicitud de copias expediente 2025-001",
    preview: "Por medio de la presente solicito copias auténticas del expediente...",
    htmlBody: `<div style="font-family: sans-serif;"><p>Por medio de la presente solicito copias auténticas del expediente No. 2025-001...</p></div>`,
    date: "2026-02-16T11:30:00Z",
    isRead: true,
    hasAttachments: false,
  },
  {
    id: "7",
    folder: "trash",
    from: { name: "Newsletter Legal", email: "news@legalweekly.com" },
    to: [PLATFORM_EMAIL],
    subject: "Las 10 novedades jurídicas de esta semana",
    preview: "Descubre las novedades más importantes en el ámbito jurídico...",
    htmlBody: `<div style="font-family: sans-serif;"><p>Novedades jurídicas de la semana...</p></div>`,
    date: "2026-02-14T08:00:00Z",
    isRead: true,
    hasAttachments: false,
  },
];
