/** Conservative event labels from the action and its object, never a free-floating verb. */
export type CautelarKind = "solicitud" | "traslado" | "negativa" | "decreto" | "relacionada";
export interface CautelarEvent {
  type: "MEDIDA_CAUTELAR";
  kind: CautelarKind;
  title: string;
  severity: "INFO" | "WARNING";
  evidence: { basis: "metadatos"; actuacion: string; anotacion: string };
  limitation: string;
  decision_confirmed: false;
  priority_basis: "tareas_y_terminos_no_evaluados";
}
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
const measure = "(?:medidas? cautelar(?:es)?|embargos?|secuestro de bienes)";
const present = new RegExp(`\\b${measure}\\b`);
const granted = new RegExp(`\\b(?:decreta|concede|adopta|ordena)\\s+(?:(?:la|las|el|los|una|unas|un|unos|siguiente|siguientes)\\s+){0,3}${measure}\\b`);
const denied = new RegExp(`\\b(?:niega|deniega|rechaza|no (?:se )?decreta|no (?:se )?concede|no accede a)\\s+(?:(?:la|las|el|los|una|unas|un|unos|solicitud|decreto|de|a)\\s+){0,5}${measure}\\b`);
const request = /\b(?:solicita|solicito|pide|pretende|solicitud|oposicion|recurso|peticion)\b/;
const notificationTitle = /\b(?:notifica(?:r|cion)?|comunica(?:r|cion)?|secretaria|cumplimiento)\b/;
const requestFraming = /\b(?:solicita|solicito|pide|pretende|oposicion|recurso|peticion)\b/;
const proceduralTitle = /^(?:recibe memoriales|recepcion|solicitud|oposicion|recurso|peticion|memorial)/;
const modifiesPriorDecision = /\b(?:revoca|revocatoria|levanta|levantamiento|modifica|aclara|aclaracion|corrige|confirma|ratifica|suspende|deja sin efecto)\b/;
const labels: Record<CautelarKind, string> = {
  solicitud: "Solicitud o pronunciamiento sobre medida cautelar",
  traslado: "Traslado de solicitud de medida cautelar",
  negativa: "Medida cautelar negada",
  decreto: "Medida cautelar decretada",
  relacionada: "Actuación relacionada con medida cautelar",
};

export function classifyCautelarEvent(actuacion: string, anotacion = ""): CautelarEvent | null {
  const title = normalize(actuacion);
  const body = normalize(anotacion);
  const text = `${title} ${body}`;
  if (!present.test(text)) return null;
  let kind: CautelarKind = "relacionada";
  // Filing/opposition titles frame any quoted decision in the annotation.
  if (proceduralTitle.test(title)) {
    kind = "solicitud";
  } else if (notificationTitle.test(title)) {
    kind = "relacionada";
  } else if (/\btraslado\b/.test(title)
    || new RegExp(`\\b(?:corre|correr|dar|ordena|concede)\\s+(?:el\\s+)?traslado\\b[^.;!?]{0,160}\\b${measure}\\b`).test(body)) {
    kind = "traslado";
  } else if (modifiesPriorDecision.test(title)) {
    // A quoted prior decree is the object of this later procedural action.
    kind = "relacionada";
  } else if (denied.test(title)) {
    kind = "negativa";
  } else if (granted.test(title) && !/\b(?:no|solicita|pretende|recurso|solicitud)\b/.test(title)) {
    kind = "decreto";
  } else if (denied.test(body) && !requestFraming.test(body)) {
    kind = "negativa";
  } else if (request.test(text)) {
    kind = "solicitud";
  } else if (/^(?:el (?:juzgado|tribunal|despacho) )?(?:resuelve[: ]+)?(?:se )?(?:decreta|concede|ordena)\b/.test(body) && granted.test(body)
    && !modifiesPriorDecision.test(body)
    && !/\b(?:no|si|podra|podria|debera|anterior|previo|recurso|considera)\b/.test(body)) {
    kind = "decreto";
  }
  return { type: "MEDIDA_CAUTELAR", kind,
    title: (kind === "decreto" || kind === "negativa") ? `${labels[kind]} según anotación; PDF pendiente de comprobar` : labels[kind],
    // The event class alone cannot lower the priority of an unexamined deadline.
    severity: "WARNING", decision_confirmed: false, priority_basis: "tareas_y_terminos_no_evaluados",
    evidence: { basis: "metadatos", actuacion, anotacion },
    limitation: "Clasificación orientativa por metadatos. No se ha comprobado el contenido decisorio del PDF ni sus tareas o términos." };
}
