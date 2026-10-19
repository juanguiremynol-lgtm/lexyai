import { describe, it, expect } from "vitest";
import { classifyCautelarEvent } from "../../supabase/functions/_shared/cautelarEvent";

describe("cautelar event describes the action on the requested measure", () => {
  it.each([
    ["Auto traslado de 5 dias", "GSGA LA PARTE DEMANDADA DE LA MEDIDA CAUTELAR SOLICITADA CON LA DEMANDA", "traslado"],
    ["Auto ordena correr traslado de solicitud de medida cautelar", "", "traslado"],
    ["Auto que resuelve", "Se ordena correr traslado de la solicitud de medida cautelar", "traslado"],
    ["Auto da traslado del auto que decreta la medida cautelar", "", "traslado"],
    ["Auto deja sin efecto el auto que decreta la medida cautelar", "", "relacionada"],
    ["Auto revoca el auto que ordena el embargo", "", "relacionada"],
    ["Auto aclara el auto que decreta la medida cautelar", "", "relacionada"],
    ["Auto que resuelve", "Se deja sin efecto el auto que decreta la medida cautelar", "relacionada"],
    ["RECIBE MEMORIALES ONLINE", "Solicita que se decrete la medida cautelar", "solicitud"],
    ["Solicitud de medida cautelar", "Se pide que se ordena la medida cautelar", "solicitud"],
    ["Oposición a medida cautelar", "Se impugna auto que decreta la medida cautelar", "solicitud"],
    ["Auto niega la medida cautelar", "", "negativa"],
    ["Auto que resuelve", "Se niega la solicitud de medida cautelar", "negativa"],
    ["Auto ordena notificar el auto que decreta la medida cautelar", "", "relacionada"],
    ["Envío de Notificación", "Auto decreta la medida cautelar", "relacionada"],
    ["Auto no decreta las medidas cautelares", "", "negativa"],
    ["Auto decreta la medida cautelar", "", "decreto"],
    ["Auto concede las medidas cautelares solicitadas", "", "decreto"],
    ["Auto que resuelve", "Se decreta la medida cautelar de suspensión provisional", "decreto"],
    ["Auto decreta pruebas", "La parte presentó solicitud de medida cautelar", "solicitud"],
    ["Auto ordena notificar", "Medida cautelar", "relacionada"],
    ["Auto que resuelve", "No se decreta la medida cautelar", "negativa"],
    ["Auto que resuelve", "Si se decreta la medida cautelar habrá que notificar", "relacionada"],
  ])("%s / %s → %s", (title, body, kind) => {
    const r = classifyCautelarEvent(title, body);
    expect(r?.kind).toBe(kind);
    if (kind !== "decreto") expect(r?.title).not.toMatch(/ordenada|decretada|concedida/i);
  });
  it("does not label an unrelated order cautelar", () => {
    expect(classifyCautelarEvent("Auto ordena correr traslado", "De la liquidación del crédito")).toBeNull();
  });
});

it('keeps metadata evidence provisional and priority independent of event class', () => {
 const traslado=classifyCautelarEvent('Auto traslado de medida cautelar','Por cinco días');
 const decreto=classifyCautelarEvent('Auto decreta la medida cautelar');
 expect(traslado?.severity).toBe(decreto?.severity);
 expect(traslado?.priority_basis).toBe('tareas_y_terminos_no_evaluados');
 expect(decreto?.decision_confirmed).toBe(false);
 expect(decreto?.evidence.basis).toBe('metadatos');
 expect(decreto?.limitation).toMatch(/PDF/);
 const quote=classifyCautelarEvent('Auto que resuelve','El demandante manifiesta que el juez decreta la medida cautelar');
 expect(quote?.kind).not.toBe('decreto');
});

import { inferWorkItemStageFromEstado } from '../lib/workflows/estado-stage-inference';
it('generic cautelar metadata never creates an embargo milestone', () => {
 for (const actuacion of ['Solicitud de medidas cautelares', 'Niega medidas cautelares', 'Auto decreta medidas cautelares']) {
  const result=inferWorkItemStageFromEstado({workflowType:'CPACA',currentStage:null,currentCgpPhase:null,actuacion});
  expect(result.triggersMilestone).toBe(false);
  expect(result.milestoneType).toBeNull();
 }
});
