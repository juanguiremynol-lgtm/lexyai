/**
 * @vitest-environment jsdom
 *
 * Route-level proof that the Dashboard renders the DATABASE catalog for
 * PETICION and GOV_PROCEDURE — not the compiled phase constants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------- catalog data
const PETICION_STAGES = Array.from({ length: 15 }, (_, i) => ({
  id: `p${i}`,
  code: `PET_${i}`,
  label: `Etapa petición ${i}`,
  display_order: i,
  is_terminal: i >= 10,
  is_procedurally_live: i < 10,
  lifecycle_band: i === 0 ? "EN_PREPARACION" : i < 10 ? "EN_CURSO" : "CONCLUIDO",
  legal_basis: "Ley 1755 de 2015",
}));

const GOV_STAGES = Array.from({ length: 20 }, (_, i) => ({
  id: `g${i}`,
  code: `GOV_${i}`,
  label: `Etapa administrativa ${i}`,
  display_order: i,
  is_terminal: i >= 16,
  is_procedurally_live: i < 16,
  lifecycle_band: i === 0 ? "EN_PREPARACION" : i < 16 ? "EN_CURSO" : "CONCLUIDO",
  legal_basis: "CPACA arts. 47-52",
}));

const WORK_ITEMS = [
  {
    id: "wi-1",
    stage: "PET_1",
    radicado: "11001400300120260001100",
    title: "Petición de prueba",
    authority_name: "Secretaría de Movilidad",
    demandados: ["Alcaldía de Medellín"],
    client_id: null,
    clients: null,
  },
];

const DEADLINES = [
  { work_item_id: "wi-1", label: "Respuesta de la entidad", deadline_date: "2026-09-01" },
];

const ATTENTION = [
  {
    work_item_id: "wi-1",
    workflow_type: "PETICION",
    condition_type: "TERMINO_POR_VENCER",
    severity: "WARNING",
    object_kind: "DEADLINE",
    object_id: "d1",
    reference_date: "2026-09-01",
    resolution_mode: "AUTOMATICA",
    detail: null,
  },
];

let catalogFails = false;

function result(table: string) {
  if (table === "workflow_stages_global") {
    if (catalogFails) return { data: null, error: { message: "boom" } };
    return { data: currentWorkflow === "PETICION" ? PETICION_STAGES : GOV_STAGES, error: null };
  }
  if (table === "workflow_stage_transitions") {
    if (catalogFails) return { data: null, error: { message: "boom" } };
    return {
      data: [
        {
          from_stage_code: "PET_1",
          to_stage_code: "PET_2",
          allowed_by_suggestion: true,
          requires_explicit_user_action: false,
          is_regression_allowed: false,
          legal_basis: null,
        },
      ],
      error: null,
    };
  }
  if (table === "v_work_item_attention_conditions") return { data: ATTENTION, error: null };
  if (table === "work_items")
    return { data: currentWorkflow === "PETICION" ? WORK_ITEMS : [], error: null };
  if (table === "work_item_deadlines") return { data: DEADLINES, error: null };
  return { data: [], error: null };
}

let currentWorkflow: "PETICION" | "GOV_PROCEDURE" = "PETICION";

function builder(table: string) {
  const payload = () => result(table);
  const chain: Record<string, unknown> = {};
  const self = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") {
        const p = Promise.resolve(payload());
        return p.then.bind(p);
      }
      return () => self;
    },
  });
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builder(table),
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  },
}));

vi.mock("@/hooks/use-practice-areas", () => ({
  PRACTICE_AREA_OPTIONS: [],
  usePracticeAreas: () => ({ isPracticed: () => true, areas: null, isLoading: false }),
}));

// Heavy, unrelated dashboard widgets.
vi.mock("@/components/dashboard/HearingTeamsNotice", () => ({ HearingTeamsNotice: () => null }));
vi.mock("@/components/dashboard/StatsCarousel", () => ({ StatsCarousel: () => null }));
vi.mock("@/components/dashboard/TodayAlertsPanel", () => ({ TodayAlertsPanel: () => null }));
vi.mock("@/components/lexy/LexyDailyCard", () => ({ LexyDailyCard: () => null }));
vi.mock("@/components/pipeline/WorkflowSuggestionsPanel", () => ({
  WorkflowSuggestionsPanel: () => null,
}));
vi.mock("@/components/workflow", () => ({ CreateWorkItemWizard: () => null }));

import Dashboard from "@/pages/Dashboard";
import { PETICION_PHASES } from "@/lib/peticiones-constants";
import { CONDITION_LABEL } from "@/components/kanban/CatalogKanbanCard";

function mount(tab: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/dashboard?tab=${tab}`]}>
        <Routes>
          <Route path="/app/dashboard" element={<Dashboard />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  catalogFails = false;
});
afterEach(() => cleanup());

describe("Dashboard route renders the database catalog", () => {
  it("PETICION shows the 15 catalog stages, not the 4 peticion_phase values", async () => {
    currentWorkflow = "PETICION";
    mount("peticiones");
    await waitFor(() => expect(screen.getAllByText("Etapa petición 0").length).toBeGreaterThan(0));
    for (const s of PETICION_STAGES) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
    }
    // the legacy enum labels are no longer columns
    for (const phase of Object.values(PETICION_PHASES)) {
      expect(screen.queryByText(phase.label)).toBeNull();
    }
  });

  it("GOV_PROCEDURE shows its 20 catalog stages with lifecycle bands", async () => {
    currentWorkflow = "GOV_PROCEDURE";
    mount("administrativos");
    await waitFor(() =>
      expect(screen.getAllByText("Etapa administrativa 0").length).toBeGreaterThan(0),
    );
    for (const s of GOV_STAGES) {
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("En curso").length).toBeGreaterThan(0);
  });

  it("exposes both catalog boards in the mobile board selector", async () => {
    currentWorkflow = "PETICION";
    mount("peticiones");
    await waitFor(() => expect(screen.getByLabelText("Seleccionar tablero")).toBeDefined());
    expect(screen.getAllByText("Peticiones").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Procesos Administrativos").length).toBeGreaterThan(0);
  });

  it("attention is a card badge and never a column; the five card fields render", async () => {
    currentWorkflow = "PETICION";
    mount("peticiones");
    await waitFor(() =>
      expect(screen.getByText("11001400300120260001100")).toBeDefined(),
    );
    expect(screen.getByText("Alcaldía de Medellín")).toBeDefined();
    expect(screen.getAllByText("Etapa petición 1").length).toBeGreaterThan(1); // column + card badge
    expect(
      screen.getByText(/Próximo término: Respuesta de la entidad — 2026-09-01/),
    ).toBeDefined();
    const attention = screen.getAllByText(CONDITION_LABEL.TERMINO_POR_VENCER);
    expect(attention.length).toBe(1); // badge only
  });

  it("an unreadable catalog shows the fault, never invented columns", async () => {
    currentWorkflow = "PETICION";
    catalogFails = true;
    mount("peticiones");
    await waitFor(() =>
      expect(screen.getByText("No se pudo cargar el catálogo de etapas")).toBeDefined(),
    );
    expect(screen.queryByText("Etapa petición 0")).toBeNull();
  });
});
