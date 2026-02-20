/**
 * Legal document template definitions for Colombia — Poder Especial & Contrato de Servicios.
 * Variables use {{variable_name}} placeholders populated from work item data, profile, or manual input.
 */

export type LegalDocumentType = "poder_especial" | "contrato_servicios";

export interface LegalTemplateVariable {
  key: string;
  label: string;
  required: boolean;
  source: "work_item" | "profile" | "organization" | "manual" | "computed";
  editable: boolean;
  defaultValue?: string;
  description?: string;
}

// ─── Poder Especial Template ─────────────────────────────

export const PODER_ESPECIAL_HTML = `
<div style="font-family:Georgia,serif;line-height:1.8;max-width:700px;margin:0 auto;">
  <h2 style="text-align:center;text-transform:uppercase;margin-bottom:32px;">Poder Especial</h2>
  
  <p><strong>{{city}}</strong>, {{date}}</p>
  
  <p>Señores<br/>
  <strong>{{court_name}}</strong><br/>
  Ciudad</p>
  
  <p style="text-align:justify;">
  Yo, <strong>{{client_full_name}}</strong>, mayor de edad, identificado(a) con cédula de ciudadanía No. <strong>{{client_cedula}}</strong> de <strong>{{client_cedula_city}}</strong>, de manera libre y voluntaria, por medio del presente escrito confiero <strong>PODER ESPECIAL</strong> amplio y suficiente al abogado(a):
  </p>
  
  <p style="text-align:center;font-size:1.1em;">
  <strong>{{lawyer_full_name}}</strong><br/>
  C.C. {{lawyer_cedula}}<br/>
  T.P. {{lawyer_tarjeta_profesional}}
  </p>
  
  <p style="text-align:justify;">
  Para que en mi nombre y representación, actúe como apoderado(a) judicial dentro del proceso de <strong>{{case_type}}</strong> que se tramita ante el despacho de su conocimiento, identificado con radicado No. <strong>{{radicado}}</strong>, en el cual la parte demandante es <strong>{{client_full_name}}</strong> y la parte demandada es <strong>{{opposing_party}}</strong>.
  </p>
  
  <p style="text-align:justify;">
  <strong>FACULTADES:</strong> {{faculties}}
  </p>
  
  <p style="text-align:justify;">
  Las anteriores facultades se entienden conferidas de conformidad con lo establecido en los artículos 73, 74 y 75 del Código General del Proceso. Este poder se otorga con facultad de sustituirlo total o parcialmente.
  </p>
  
  <p style="text-align:justify;">
  Declaro bajo la gravedad del juramento que no he conferido poder a otro abogado para el mismo asunto, y que acepto la responsabilidad que se derive de la presente actuación.
  </p>
  
  <p style="text-align:justify;">
  Del señor(a) Juez(a), atentamente,
  </p>
  
  <div style="margin-top:48px;">
    <p><strong>PODERDANTE:</strong></p>
    <br/><br/>
    <p>___________________________________</p>
    <p><strong>{{client_full_name}}</strong></p>
    <p>C.C. {{client_cedula}} de {{client_cedula_city}}</p>
  </div>
  
  <div style="margin-top:32px;">
    <p><strong>ACEPTO:</strong></p>
    <br/><br/>
    <p>___________________________________</p>
    <p><strong>{{lawyer_full_name}}</strong></p>
    <p>C.C. {{lawyer_cedula}}</p>
    <p>T.P. {{lawyer_tarjeta_profesional}}</p>
  </div>
</div>`;

export const PODER_ESPECIAL_VARIABLES: LegalTemplateVariable[] = [
  { key: "client_full_name", label: "Nombre completo del cliente", required: true, source: "work_item", editable: true },
  { key: "client_cedula", label: "Cédula del cliente", required: true, source: "work_item", editable: true },
  { key: "client_cedula_city", label: "Ciudad de expedición cédula", required: true, source: "manual", editable: true, defaultValue: "" },
  { key: "lawyer_full_name", label: "Nombre del abogado", required: true, source: "profile", editable: false },
  { key: "lawyer_cedula", label: "Cédula del abogado", required: true, source: "profile", editable: false },
  { key: "lawyer_tarjeta_profesional", label: "Tarjeta Profesional", required: true, source: "profile", editable: false },
  { key: "radicado", label: "Radicado del proceso", required: false, source: "work_item", editable: true },
  { key: "court_name", label: "Juzgado/Despacho", required: true, source: "work_item", editable: true },
  { key: "opposing_party", label: "Parte contraria", required: true, source: "work_item", editable: true },
  { key: "case_type", label: "Tipo de proceso", required: true, source: "work_item", editable: true },
  { key: "city", label: "Ciudad", required: true, source: "computed", editable: true, defaultValue: "Medellín" },
  { key: "date", label: "Fecha", required: true, source: "computed", editable: false },
  {
    key: "faculties",
    label: "Facultades",
    required: true,
    source: "manual",
    editable: true,
    defaultValue: "Presentar demandas, contestar demandas, asistir a audiencias, presentar y controvertir pruebas, interponer recursos ordinarios y extraordinarios, conciliar, recibir, transigir, desistir, sustituir el poder, y en general, para realizar todos los actos procesales que sean necesarios para la defensa de mis intereses dentro del mencionado proceso.",
  },
];

// ─── Contrato de Servicios Template ──────────────────────

export const CONTRATO_SERVICIOS_HTML = `
<div style="font-family:Georgia,serif;line-height:1.8;max-width:700px;margin:0 auto;">
  <h2 style="text-align:center;text-transform:uppercase;margin-bottom:32px;">Contrato de Prestación de Servicios Profesionales de Abogado</h2>
  
  <p style="text-align:justify;">
  Entre los suscritos, a saber: <strong>{{client_full_name}}</strong>, mayor de edad, identificado(a) con cédula de ciudadanía No. <strong>{{client_cedula}}</strong>, domiciliado(a) en <strong>{{client_address}}</strong>, con correo electrónico <strong>{{client_email}}</strong> y teléfono <strong>{{client_phone}}</strong>, quien para efectos del presente contrato se denominará <strong>EL MANDANTE</strong>; y de otra parte, <strong>{{lawyer_full_name}}</strong>, mayor de edad, identificado(a) con cédula de ciudadanía No. <strong>{{lawyer_cedula}}</strong>, portador(a) de la Tarjeta Profesional No. <strong>{{lawyer_tarjeta_profesional}}</strong>{{firm_clause}}, quien para efectos del presente contrato se denominará <strong>EL MANDATARIO</strong>, hemos convenido celebrar el presente contrato de mandato que se regirá por las siguientes cláusulas:
  </p>
  
  <h3>CLÁUSULA PRIMERA — OBJETO</h3>
  <p style="text-align:justify;">
  EL MANDANTE confiere mandato a EL MANDATARIO para que le preste servicios profesionales de abogado en relación con: <strong>{{case_description}}</strong>{{radicado_clause}}.
  </p>
  
  <h3>CLÁUSULA SEGUNDA — OBLIGACIONES DEL MANDATARIO</h3>
  <p style="text-align:justify;">
  EL MANDATARIO se obliga a: (a) Representar judicialmente al MANDANTE con diligencia y profesionalismo; (b) Mantener informado al MANDANTE sobre el estado del proceso; (c) Asistir a todas las audiencias y diligencias programadas; (d) Presentar oportunamente los escritos, recursos y demás actuaciones procesales necesarias; (e) Guardar secreto profesional sobre la información recibida.
  </p>
  
  <h3>CLÁUSULA TERCERA — OBLIGACIONES DEL MANDANTE</h3>
  <p style="text-align:justify;">
  EL MANDANTE se obliga a: (a) Pagar los honorarios pactados en la forma y tiempo convenidos; (b) Suministrar toda la información y documentación necesaria; (c) Atender oportunamente las solicitudes del MANDATARIO; (d) No realizar actuaciones procesales por su cuenta sin consultar al MANDATARIO.
  </p>
  
  <h3>CLÁUSULA CUARTA — HONORARIOS</h3>
  <p style="text-align:justify;">
  {{honorarios_clause}}
  </p>
  
  <h3>CLÁUSULA QUINTA — FORMA DE PAGO</h3>
  <p style="text-align:justify;">
  {{payment_schedule}}
  </p>
  
  <h3>CLÁUSULA SEXTA — CONFIDENCIALIDAD</h3>
  <p style="text-align:justify;">
  Las partes se obligan a mantener estricta confidencialidad sobre toda la información intercambiada con motivo del presente contrato, de conformidad con lo establecido en la Ley 1581 de 2012 y demás normas concordantes sobre protección de datos personales.
  </p>
  
  <h3>CLÁUSULA SÉPTIMA — DURACIÓN Y TERMINACIÓN</h3>
  <p style="text-align:justify;">
  El presente contrato tendrá una duración de <strong>{{contract_duration}}</strong>. El contrato podrá terminarse anticipadamente por mutuo acuerdo, por incumplimiento de cualquiera de las partes, o por revocatoria unilateral del mandato en los términos del artículo 2189 del Código Civil.
  </p>
  
  <h3>CLÁUSULA OCTAVA — TRATAMIENTO DE DATOS</h3>
  <p style="text-align:justify;">
  EL MANDANTE autoriza a EL MANDATARIO para el tratamiento de sus datos personales conforme a la Ley 1581 de 2012, exclusivamente para los fines del presente contrato y las actuaciones judiciales derivadas del mismo.
  </p>
  
  <h3>CLÁUSULA NOVENA — RESOLUCIÓN DE CONTROVERSIAS</h3>
  <p style="text-align:justify;">
  Cualquier controversia derivada del presente contrato será resuelta en primera instancia mediante conciliación, y en su defecto, ante la jurisdicción ordinaria de <strong>{{city}}</strong>.
  </p>
  
  <p style="text-align:justify;">
  Para constancia se firma en <strong>{{city}}</strong>, a los <strong>{{date}}</strong>.
  </p>
  
  <div style="display:flex;gap:48px;margin-top:48px;">
    <div style="flex:1;">
      <p><strong>EL MANDANTE:</strong></p>
      <br/><br/>
      <p>___________________________________</p>
      <p><strong>{{client_full_name}}</strong></p>
      <p>C.C. {{client_cedula}}</p>
    </div>
    <div style="flex:1;">
      <p><strong>EL MANDATARIO:</strong></p>
      <br/><br/>
      <p>___________________________________</p>
      <p><strong>{{lawyer_full_name}}</strong></p>
      <p>C.C. {{lawyer_cedula}}</p>
      <p>T.P. {{lawyer_tarjeta_profesional}}</p>
    </div>
  </div>
</div>`;

export const CONTRATO_SERVICIOS_VARIABLES: LegalTemplateVariable[] = [
  { key: "client_full_name", label: "Nombre completo del cliente", required: true, source: "work_item", editable: true },
  { key: "client_cedula", label: "Cédula del cliente", required: true, source: "work_item", editable: true },
  { key: "client_address", label: "Dirección del cliente", required: true, source: "manual", editable: true },
  { key: "client_email", label: "Correo del cliente", required: true, source: "work_item", editable: true },
  { key: "client_phone", label: "Teléfono del cliente", required: true, source: "manual", editable: true },
  { key: "lawyer_full_name", label: "Nombre del abogado", required: true, source: "profile", editable: false },
  { key: "lawyer_cedula", label: "Cédula del abogado", required: true, source: "profile", editable: false },
  { key: "lawyer_tarjeta_profesional", label: "Tarjeta Profesional", required: true, source: "profile", editable: false },
  { key: "firm_name", label: "Nombre de la firma", required: false, source: "organization", editable: true },
  { key: "firm_nit", label: "NIT de la firma", required: false, source: "manual", editable: true },
  { key: "firm_address", label: "Dirección de la firma", required: false, source: "manual", editable: true },
  { key: "case_description", label: "Descripción del asunto", required: true, source: "work_item", editable: true },
  { key: "radicado", label: "Radicado (si existe)", required: false, source: "work_item", editable: true },
  { key: "honorarios_amount", label: "Monto de honorarios (COP)", required: true, source: "manual", editable: true },
  { key: "honorarios_type", label: "Tipo de honorarios", required: true, source: "manual", editable: true, defaultValue: "Honorarios fijos" },
  { key: "honorarios_percentage", label: "Porcentaje cuota litis", required: false, source: "manual", editable: true },
  { key: "payment_schedule", label: "Forma de pago", required: true, source: "manual", editable: true, defaultValue: "El valor total de los honorarios se pagará de la siguiente manera: 50% al momento de la firma del presente contrato y 50% restante al finalizar la primera instancia del proceso." },
  { key: "contract_duration", label: "Duración del contrato", required: true, source: "manual", editable: true, defaultValue: "hasta la terminación del proceso en todas sus instancias" },
  { key: "city", label: "Ciudad", required: true, source: "computed", editable: true, defaultValue: "Medellín" },
  { key: "date", label: "Fecha", required: true, source: "computed", editable: false },
  { key: "firm_clause", label: "(auto) Cláusula firma", required: false, source: "computed", editable: false },
  { key: "radicado_clause", label: "(auto) Cláusula radicado", required: false, source: "computed", editable: false },
  { key: "honorarios_clause", label: "(auto) Cláusula honorarios", required: false, source: "computed", editable: false },
];

// ─── Labels ──────────────────────────────────────────────

export const LEGAL_DOCUMENT_TYPE_LABELS: Record<LegalDocumentType, string> = {
  poder_especial: "Poder Especial",
  contrato_servicios: "Contrato de Prestación de Servicios",
};

// ─── Template Registry ───────────────────────────────────

export const LEGAL_TEMPLATES: Record<LegalDocumentType, { html: string; variables: LegalTemplateVariable[] }> = {
  poder_especial: { html: PODER_ESPECIAL_HTML, variables: PODER_ESPECIAL_VARIABLES },
  contrato_servicios: { html: CONTRATO_SERVICIOS_HTML, variables: CONTRATO_SERVICIOS_VARIABLES },
};

// ─── Utilities ───────────────────────────────────────────

export function formatColombianDate(date: Date): string {
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

export function renderLegalTemplate(html: string, variables: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
  }
  return result;
}

export function getWorkflowTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    CGP: "Civil (Código General del Proceso)",
    CPACA: "Contencioso Administrativo (CPACA)",
    TUTELA: "Tutela",
    LABORAL: "Laboral",
    PENAL_906: "Penal (Ley 906)",
  };
  return labels[type] || type;
}
