/** @vitest-environment jsdom */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { WorkItemActCard, type WorkItemAct } from "@/pages/WorkItemDetail/tabs/WorkItemActCard";

afterEach(cleanup);
const base = {
  id: "a1", work_item_id: "w1", description: "RECIBE MEMORIALES ONLINE - Documentos anexos: 6",
  source: "samai", created_at: "2026-10-18T10:00:00Z", raw_data: {},
} as WorkItemAct;

describe("act card distinguishes announcements from files", () => {
  it("shows six announced annexes even when no descriptors were collected", () => {
    render(<WorkItemActCard act={base} />);
    expect(screen.getByText("Anexos anunciados: 6.")).toBeTruthy();
    expect(screen.getByText(/sin archivos recuperados y verificados/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("does not hide a stored link because an act is CLASIFICADA or call it restricted", () => {
    const url = "https://storage.googleapis.com/andromeda-samai-documentos-2026/samai/file.pdf";
    render(<WorkItemActCard act={{ ...base, raw_data: { estado: "CLASIFICADA", anexos_documentos: [{ descripcion: "Memorial", urlDescarga: url }] } }} />);
    expect(screen.getByRole("link", { name: /Descargar/ }).getAttribute("href")).toBe(url);
    expect(screen.getByText("Contenido sin verificar")).toBeTruthy();
    expect(screen.queryByText("Documento clasificado")).toBeNull();
  });
  it("retains a SAMAI descriptor without URLs and does not expose javascript URLs", () => {
    render(<WorkItemActCard act={{ ...base, raw_data: { anexos_documentos: [{ descripcion: "Anexo anunciado" }, { descripcion: "Entrada inválida", urlVer: "javascript:alert(1)" }] } }} />);
    expect(screen.getByText("Anexo anunciado")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByText("Sin enlace registrado")).toHaveLength(2);
  });
});
