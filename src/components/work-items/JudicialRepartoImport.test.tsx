/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JudicialRepartoButton } from "./JudicialRepartoImport";

const backend = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: backend.invoke },
    rpc: backend.rpc,
    auth: { getUser: backend.getUser },
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const receipt = {
  id: "fixture-proof",
  source: "PDF",
  work_item_id: null,
  pdf_name: "constancia.pdf",
  suggestions: {
    fields: {
      kind: { value: "RECEPCION", source: "PDF" },
      external_reference: { value: "VJE-4492", source: "PDF" },
      receipt_on: { value: "2026-11-23", source: "PDF" },
    },
    pdf_text_read: true,
  },
};

function open(props: Parameters<typeof JudicialRepartoButton>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <JudicialRepartoButton {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: props.existingWorkItemId || props.detectionId ? "Importar comprobante" : "Radicación y reparto" }));
}

async function upload() {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "PDF" }), { button: 0, ctrlKey: false });
  fireEvent.change(await screen.findByLabelText("Constancia o acta en PDF (hasta 10 MB)"), {
    target: { files: [new File(["fixture"], "constancia.pdf", { type: "application/pdf" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preparar importación" }));
}

describe("judicial reparto import from its normal button", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    backend.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
    backend.rpc.mockResolvedValue({ data: [], error: null });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps receipt and filing reference separate and waits for explicit confirmation", async () => {
    backend.invoke.mockResolvedValue({ data: { draft: receipt }, error: null });
    backend.rpc.mockResolvedValue({ data: { work_item_id: "expediente", created: false }, error: null });
    open({ existingWorkItemId: "expediente" });
    await upload();
    const save = await screen.findByRole("button", { name: "Vincular comprobante" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect((screen.getByLabelText("Referencia de la solicitud") as HTMLInputElement).value).toBe("VJE-4492");
    expect((screen.getByLabelText("Radicado judicial (23 dígitos)") as HTMLInputElement).value).toBe("");
    expect(backend.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Revisé el comprobante/ }));
    fireEvent.click(save);
    await waitFor(() => expect(backend.rpc).toHaveBeenCalledExactlyOnceWith("confirm_judicial_reparto", expect.objectContaining({
      p_import_id: "fixture-proof",
      p_work_item_id: "expediente",
      p_kind: "RECEPCION",
      p_reference: "VJE-4492",
      p_event_on: "2026-11-23",
      p_radicado: null,
      p_confirmed: true,
    })));
  });

  it("opens the existing expediente when the same proof was already linked", async () => {
    backend.invoke.mockResolvedValue({ data: { draft: { ...receipt, work_item_id: "previous" } }, error: null });
    open();
    await upload();
    const link = await screen.findByRole("link", { name: "Abrir expediente" });
    expect(link.getAttribute("href")).toBe("/app/work-items/previous?tab=documentos");
    expect(backend.rpc).not.toHaveBeenCalled();
  });

  it("previews both records and sends the signed inventory only upon confirmation", async () => {
    const radicado = "05001310302120268888000";
    backend.invoke.mockImplementation(async (name) => name === "sync-by-radicado" ? {
      data: {
        ok: true, radicado, workflow_type: "CGP", found_in_source: true,
        process_data: { actuaciones: [{ fecha: "2026-11-18", actuacion: "Auto admite demanda" }] },
        intake_preview: {
          estados: [{ fecha: "2026-11-19", titulo: "Estado 148", fuente: "publicaciones" }],
          acts_complete: true, states_complete: true, states_source: "Publicaciones Procesales",
          receipt: { payload: "signed inventory", signature: "seal" },
        },
      },
      error: null,
    } : ({
      data: { draft: {
        ...receipt,
        suggestions: { fields: {
          kind: { value: "REPARTO", source: "PDF" },
          radicado: { value: radicado, source: "PDF" },
        } },
      } },
      error: null,
    }));
    backend.rpc.mockImplementation(async (name) => ({
      data: name === "find_judicial_reparto_matches" ? [] : { work_item_id: "new-expediente", created: true },
      error: null,
    }));
    open();
    await upload();
    fireEvent.change(await screen.findByLabelText("Nombre del expediente"), { target: { value: "Expediente de prueba" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Revisé el comprobante/ }));
    const create = screen.getByRole<HTMLButtonElement>("button", { name: "Crear expediente" });
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Consultar actuaciones y estados" }));
    await screen.findByText("Auto admite demanda");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Estados (1)" }), { button: 0, ctrlKey: false });
    await screen.findByText("Estado 148");
    expect(backend.rpc.mock.calls.every(([name]) => name === "find_judicial_reparto_matches")).toBe(true);
    fireEvent.click(create);
    await waitFor(() => expect(backend.rpc).toHaveBeenCalledWith("confirm_judicial_reparto_with_intake_preview", expect.objectContaining({
      p_work_item_id: null,
      p_workflow_type: "CGP",
      p_kind: "REPARTO",
      p_radicado: radicado,
      p_title: "Expediente de prueba",
      p_payload: "signed inventory",
      p_signature: "seal",
    })));
  });

  it("reads only the chosen Outlook attachment from a detected process", async () => {
    backend.invoke.mockImplementation(async (_name, options) =>
      options.body.action === "inspect"
        ? { data: { mail: { subject: "Acta de reparto", sender: "juzgado@example.test" }, pdfs: [{ id: "pdf1", name: "acta.pdf", size: 1000 }] }, error: null }
        : { data: { draft: { ...receipt, source: "OUTLOOK" } }, error: null },
    );
    open({ detectionId: "detected" });
    fireEvent.click(await screen.findByRole("button", { name: "Preparar importación" }));
    await screen.findByLabelText("Referencia de la solicitud");
    expect(backend.invoke).toHaveBeenNthCalledWith(1, "import-judicial-reparto", {
      body: { action: "inspect", detection_id: "detected" },
    });
    expect(backend.invoke).toHaveBeenNthCalledWith(2, "import-judicial-reparto", {
      body: { action: "prepare", detection_id: "detected", attachment_id: "pdf1" },
    });
  });
});
