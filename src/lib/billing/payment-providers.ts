/**
 * Payment Provider Registry — Single source of truth for all supported payment gateways.
 * 
 * Each provider declares its required config keys, capabilities, documentation,
 * and integration metadata. The wizard, edge functions, and provider factory
 * all reference this registry.
 */

export interface PaymentProviderKey {
  key: string;
  label: string;
  secret: boolean;
  hint: string;
  required: boolean;
  placeholder?: string;
}

export interface PaymentProviderCapability {
  id: string;
  label: string;
  description: string;
}

export interface PaymentProviderDefinition {
  id: string;
  name: string;
  description: string;
  country: string;
  currencies: string[];
  docUrl: string;
  logoIcon: string; // lucide icon name
  recommended: boolean;
  status: 'available' | 'coming_soon' | 'beta';
  keys: PaymentProviderKey[];
  capabilities: PaymentProviderCapability[];
  webhookSupport: boolean;
  webhookInstructions?: string;
  sandboxAvailable: boolean;
  integrationNotes: string;
}

/**
 * All supported payment providers.
 * Adding a new provider here automatically makes it available in the wizard,
 * the edge function, and the provider factory.
 */
export const PAYMENT_PROVIDERS: PaymentProviderDefinition[] = [
  {
    id: "wompi",
    name: "Wompi",
    description: "Pasarela de pagos líder en Colombia. Soporta PSE, tarjetas, Nequi y más.",
    country: "Colombia",
    currencies: ["COP"],
    docUrl: "https://docs.wompi.co/",
    logoIcon: "Banknote",
    recommended: true,
    status: "available",
    webhookSupport: true,
    sandboxAvailable: true,
    webhookInstructions: "En el dashboard de Wompi, vaya a Configuración > Webhooks y agregue la URL del endpoint. El secreto se usa para verificar la firma HMAC-SHA256.",
    integrationNotes: "Wompi es la pasarela recomendada para operaciones en Colombia. Soporta pagos con PSE (débito bancario), tarjetas de crédito/débito, Nequi y Bancolombia QR.",
    keys: [
      {
        key: "PUBLIC_KEY",
        label: "Clave Pública",
        secret: false,
        hint: "Se usa en el frontend para iniciar transacciones. Encuéntrela en Wompi Dashboard > Desarrolladores.",
        required: true,
        placeholder: "pub_test_...",
      },
      {
        key: "PRIVATE_KEY",
        label: "Clave Privada",
        secret: true,
        hint: "Solo se usa en el backend para verificar y crear transacciones. Nunca la comparta.",
        required: true,
        placeholder: "prv_test_...",
      },
      {
        key: "WEBHOOK_SECRET",
        label: "Secreto de Webhook",
        secret: true,
        hint: "Para verificar la firma HMAC-SHA256 de los webhooks entrantes de Wompi.",
        required: true,
        placeholder: "whsec_...",
      },
      {
        key: "INTEGRITY_SECRET",
        label: "Secreto de Integridad",
        secret: true,
        hint: "Para generar la firma de integridad de la transacción antes de enviarla.",
        required: true,
        placeholder: "integrity_...",
      },
      {
        key: "ENVIRONMENT",
        label: "Ambiente",
        secret: false,
        hint: "'sandbox' para pruebas, 'production' para producción.",
        required: true,
        placeholder: "sandbox",
      },
    ],
    capabilities: [
      { id: "cards", label: "Tarjetas", description: "Visa, Mastercard, American Express" },
      { id: "pse", label: "PSE", description: "Débito bancario colombiano" },
      { id: "nequi", label: "Nequi", description: "Pagos móviles con Nequi" },
      { id: "bancolombia_qr", label: "Bancolombia QR", description: "Pago con QR de Bancolombia" },
      { id: "webhooks", label: "Webhooks", description: "Notificaciones en tiempo real de transacciones" },
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Plataforma de pagos global. Ideal para clientes internacionales y múltiples monedas.",
    country: "Global",
    currencies: ["USD", "EUR", "COP", "MXN"],
    docUrl: "https://docs.stripe.com/",
    logoIcon: "CreditCard",
    recommended: false,
    status: "available",
    webhookSupport: true,
    sandboxAvailable: true,
    webhookInstructions: "En Stripe Dashboard > Developers > Webhooks, cree un endpoint con los eventos checkout.session.completed, invoice.paid, customer.subscription.updated.",
    integrationNotes: "Stripe ofrece la cobertura más amplia de métodos de pago internacionales. Ideal si tiene clientes fuera de Colombia.",
    keys: [
      {
        key: "PUBLISHABLE_KEY",
        label: "Clave Publicable",
        secret: false,
        hint: "Se usa en el frontend. Encuéntrela en Stripe Dashboard > Developers > API Keys.",
        required: true,
        placeholder: "pk_test_...",
      },
      {
        key: "SECRET_KEY",
        label: "Clave Secreta",
        secret: true,
        hint: "Solo backend. Encuéntrela en Stripe Dashboard > Developers > API Keys.",
        required: true,
        placeholder: "sk_test_...",
      },
      {
        key: "WEBHOOK_SECRET",
        label: "Secreto de Webhook",
        secret: true,
        hint: "Se genera al crear el endpoint de webhook en Stripe Dashboard.",
        required: true,
        placeholder: "whsec_...",
      },
    ],
    capabilities: [
      { id: "cards", label: "Tarjetas", description: "Todas las marcas principales" },
      { id: "subscriptions", label: "Suscripciones", description: "Facturación recurrente nativa" },
      { id: "invoices", label: "Facturas", description: "Generación automática de facturas" },
      { id: "webhooks", label: "Webhooks", description: "Eventos en tiempo real" },
      { id: "checkout", label: "Checkout Hosted", description: "Página de pago preconstruida" },
    ],
  },
  {
    id: "payu",
    name: "PayU Latam",
    description: "Pasarela con amplia cobertura en Latinoamérica. Soporta métodos locales de varios países.",
    country: "Latam",
    currencies: ["COP", "MXN", "ARS", "BRL", "PEN", "CLP"],
    docUrl: "https://developers.payulatam.com/",
    logoIcon: "Globe",
    recommended: false,
    status: "available",
    webhookSupport: true,
    sandboxAvailable: true,
    webhookInstructions: "En el panel de PayU, configure la URL de confirmación y la URL de respuesta en Configuración > Configuración Técnica.",
    integrationNotes: "PayU Latam es ideal si opera en múltiples países de Latinoamérica. Soporta pagos en efectivo (Baloto, Efecty), PSE, y tarjetas.",
    keys: [
      {
        key: "API_KEY",
        label: "API Key",
        secret: true,
        hint: "Encuéntrela en PayU > Configuración > Configuración Técnica.",
        required: true,
        placeholder: "4Vj8eK4rloUd...",
      },
      {
        key: "API_LOGIN",
        label: "API Login",
        secret: false,
        hint: "Identificador del comercio para la API.",
        required: true,
        placeholder: "pRRXKOl8ikMmt9u",
      },
      {
        key: "MERCHANT_ID",
        label: "Merchant ID",
        secret: false,
        hint: "ID del comercio en PayU.",
        required: true,
        placeholder: "508029",
      },
      {
        key: "ACCOUNT_ID",
        label: "Account ID",
        secret: false,
        hint: "ID de la cuenta del país (Colombia, México, etc).",
        required: true,
        placeholder: "512321",
      },
      {
        key: "WEBHOOK_SECRET",
        label: "Clave de Confirmación",
        secret: true,
        hint: "Secreto para verificar las notificaciones de confirmación.",
        required: false,
        placeholder: "confirm_...",
      },
    ],
    capabilities: [
      { id: "cards", label: "Tarjetas", description: "Visa, Mastercard, Diners" },
      { id: "pse", label: "PSE", description: "Débito bancario (Colombia)" },
      { id: "cash", label: "Efectivo", description: "Baloto, Efecty, OXXO según país" },
      { id: "bank_transfer", label: "Transferencia", description: "Transferencias bancarias locales" },
      { id: "webhooks", label: "Webhooks", description: "Confirmaciones de pago" },
    ],
  },
  {
    id: "placetopay",
    name: "PlacetoPay (Evertec)",
    description: "Gateway empresarial colombiano. Usado por grandes corporaciones y entidades gubernamentales.",
    country: "Colombia",
    currencies: ["COP", "USD"],
    docUrl: "https://docs.placetopay.dev/",
    logoIcon: "Building2",
    recommended: false,
    status: "available",
    webhookSupport: true,
    sandboxAvailable: true,
    webhookInstructions: "PlacetoPay usa un modelo de notificación por URL de retorno. Configure la URL de notificación en su panel de comercio.",
    integrationNotes: "PlacetoPay (ahora Evertec) es muy usado en el sector corporativo y gubernamental colombiano. Ideal para cumplimiento normativo estricto.",
    keys: [
      {
        key: "LOGIN",
        label: "Login",
        secret: false,
        hint: "Identificador del comercio. Lo obtiene al crear su comercio en PlacetoPay.",
        required: true,
        placeholder: "6dd490faf...",
      },
      {
        key: "TRANKEY",
        label: "TranKey",
        secret: true,
        hint: "Clave secreta de transacción. Solo backend.",
        required: true,
        placeholder: "024h1IlD...",
      },
      {
        key: "BASE_URL",
        label: "URL Base de la API",
        secret: false,
        hint: "URL del ambiente. Sandbox: https://checkout-test.placetopay.com | Producción: https://checkout.placetopay.com",
        required: true,
        placeholder: "https://checkout-test.placetopay.com",
      },
    ],
    capabilities: [
      { id: "cards", label: "Tarjetas", description: "Visa, Mastercard, Diners, American Express" },
      { id: "pse", label: "PSE", description: "Débito bancario colombiano" },
      { id: "mixed_checkout", label: "Checkout Mixto", description: "Combinar métodos de pago en una sesión" },
      { id: "tokenization", label: "Tokenización", description: "Pagos recurrentes con tarjeta tokenizada" },
      { id: "webhooks", label: "Notificaciones", description: "Callbacks de estado de transacción" },
    ],
  },
  {
    id: "mercadopago",
    name: "Mercado Pago",
    description: "Ecosistema de pagos de MercadoLibre. Gran adopción en Latam con múltiples métodos.",
    country: "Latam",
    currencies: ["COP", "ARS", "BRL", "MXN", "CLP", "PEN", "UYU"],
    docUrl: "https://www.mercadopago.com.co/developers/",
    logoIcon: "ShoppingBag",
    recommended: false,
    status: "beta",
    webhookSupport: true,
    sandboxAvailable: true,
    webhookInstructions: "En Mercado Pago > Tu negocio > Configuraciones > Notificaciones, agregue su URL de webhook y seleccione los temas: payment, merchant_order.",
    integrationNotes: "Mercado Pago tiene la mayor adopción en Argentina, Brasil y México. En Colombia, es una alternativa viable con QR y transferencias.",
    keys: [
      {
        key: "ACCESS_TOKEN",
        label: "Access Token",
        secret: true,
        hint: "Token de producción o sandbox. Encuéntrelo en Credenciales de la aplicación.",
        required: true,
        placeholder: "APP_USR-...",
      },
      {
        key: "PUBLIC_KEY",
        label: "Public Key",
        secret: false,
        hint: "Clave pública para el SDK de frontend.",
        required: true,
        placeholder: "APP_USR-...",
      },
      {
        key: "WEBHOOK_SECRET",
        label: "Webhook Secret",
        secret: true,
        hint: "Secreto para verificar notificaciones IPN.",
        required: false,
        placeholder: "whsec_...",
      },
    ],
    capabilities: [
      { id: "cards", label: "Tarjetas", description: "Visa, Mastercard, American Express" },
      { id: "qr", label: "QR", description: "Pagos con código QR" },
      { id: "checkout_pro", label: "Checkout Pro", description: "Página de pago hosted" },
      { id: "subscriptions", label: "Suscripciones", description: "Pagos recurrentes" },
      { id: "webhooks", label: "IPN/Webhooks", description: "Notificaciones de pago" },
    ],
  },
  {
    id: "epayco",
    name: "ePayco",
    description: "Pasarela colombiana con buena cobertura de métodos locales y buen soporte técnico.",
    country: "Colombia",
    currencies: ["COP"],
    docUrl: "https://docs.epayco.co/",
    logoIcon: "Wallet",
    recommended: false,
    status: "available",
    webhookSupport: true,
    sandboxAvailable: true,
    webhookInstructions: "En ePayco > Integraciones > Configuración, establezca la URL de confirmación y respuesta.",
    integrationNotes: "ePayco es una alternativa colombiana a Wompi con buen soporte para Daviplata, PSE y pagos en efectivo.",
    keys: [
      {
        key: "PUBLIC_KEY",
        label: "Clave Pública",
        secret: false,
        hint: "Encuéntrela en ePayco > Integraciones > Llaves API.",
        required: true,
        placeholder: "public_key_...",
      },
      {
        key: "PRIVATE_KEY",
        label: "Clave Privada",
        secret: true,
        hint: "Solo backend. ePayco > Integraciones > Llaves API.",
        required: true,
        placeholder: "private_key_...",
      },
      {
        key: "CUSTOMER_ID",
        label: "Customer ID",
        secret: false,
        hint: "ID del comercio en ePayco.",
        required: true,
        placeholder: "123456",
      },
      {
        key: "P_KEY",
        label: "P_Key (Checkout)",
        secret: true,
        hint: "Clave para el checkout. Se encuentra junto a las llaves API.",
        required: true,
        placeholder: "p_key_...",
      },
    ],
    capabilities: [
      { id: "cards", label: "Tarjetas", description: "Visa, Mastercard, Diners, American Express" },
      { id: "pse", label: "PSE", description: "Débito bancario colombiano" },
      { id: "cash", label: "Efectivo", description: "Efecty, Baloto, SuRed" },
      { id: "daviplata", label: "Daviplata", description: "Pagos móviles Daviplata" },
      { id: "webhooks", label: "Webhooks", description: "Confirmaciones automáticas" },
    ],
  },
];

/** Get a provider definition by ID */
export function getPaymentProvider(id: string): PaymentProviderDefinition | undefined {
  return PAYMENT_PROVIDERS.find((p) => p.id === id);
}

/** Get all available (non-coming-soon) providers */
export function getAvailableProviders(): PaymentProviderDefinition[] {
  return PAYMENT_PROVIDERS.filter((p) => p.status !== "coming_soon");
}

/** Get the full config key for a provider (e.g., WOMPI_PUBLIC_KEY) */
export function getProviderConfigKey(providerId: string, keyId: string): string {
  return `${providerId.toUpperCase()}_${keyId}`;
}

/** Get all config keys for a provider */
export function getProviderConfigKeys(providerId: string): string[] {
  const provider = getPaymentProvider(providerId);
  if (!provider) return [];
  return provider.keys.map((k) => getProviderConfigKey(providerId, k.key));
}

/** Get secret keys for a provider */
export function getProviderSecretKeys(providerId: string): Set<string> {
  const provider = getPaymentProvider(providerId);
  if (!provider) return new Set();
  return new Set(
    provider.keys.filter((k) => k.secret).map((k) => getProviderConfigKey(providerId, k.key))
  );
}
