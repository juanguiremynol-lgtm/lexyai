/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { rpc, listGrants, revokeGrant } = vi.hoisted(() => ({ rpc: vi.fn(), listGrants: vi.fn(), revokeGrant: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { oauth: { listGrants, revokeGrant } } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-email-connection", () => ({
  connectionHealth: () => "NO_CONECTADO",
  useEmailConnection: () => ({ connection: null, isLoading: false, isConnected: false, connect: {}, disconnect: {}, sync: {}, requestAdminConsent: {} }),
  useOutlookSendAuditLog: () => ({ data: [], isLoading: false }),
}));
import SettingsConnections from "@/pages/SettingsConnections";
const client = "00000000-0000-0000-0000-000000000041";
const read = { data: [{ oauth_client_id: client, access_level: "read", manage_granted_at: null }], error: null };
const manage = { data: [{ oauth_client_id: client, access_level: "manage", manage_granted_at: "2026-10-24T20:00:00Z" }], error: null };
beforeEach(() => {
  vi.resetAllMocks();
  listGrants.mockResolvedValue({ data: [{ client: { client_id: client, name: "Synthetic assistant" }, scopes: ["openid"] }], error: null });
});
afterEach(cleanup);
describe("SettingsConnections rendered permission boundaries", () => {
  it("clears stale manage state on a failed refresh and permits changes only after a successful refresh", async () => {
    rpc.mockResolvedValueOnce(manage).mockResolvedValueOnce({ data: null, error: { message: "permission load failed" } }).mockResolvedValueOnce(read);
    render(<SettingsConnections />);
    await screen.findByText("Puede gestionar");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar lista" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Permitir gestionar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Puede gestionar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Permitir gestionar" }));
    expect(rpc.mock.calls.every(([name]) => name === "list_my_mcp_connections")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar lista" }));
    await screen.findByText("Solo lectura");
    expect((screen.getByRole("button", { name: "Permitir gestionar" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each([{ data: null }, { data: [] }])("unknown/missing permission response $data does not enable management", async ({ data }) => {
    rpc.mockResolvedValue({ data, error: null });
    render(<SettingsConnections />);
    await waitFor(() => expect(screen.queryByText("Cargando conexiones…")).toBeNull());
    expect((screen.getByRole("button", { name: "Permitir gestionar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Solo lectura")).toBeNull();
  });
  it("disables changes during refresh and retains scope and retention disclosure before opt-in", async () => {
    let resolve: (value: typeof read) => void = () => undefined;
    rpc.mockImplementation(() => new Promise<typeof read>((done) => { resolve = done; }));
    render(<SettingsConnections />);
    const control = await screen.findByRole("button", { name: "Permitir gestionar" });
    expect((control as HTMLButtonElement).disabled).toBe(true);
    const disclosures = screen.getByText("Al permitir gestionar tu cartera").parentElement;
    expect(disclosures?.textContent).toContain("Crear asuntos y asignar un radicado");
    expect(disclosures?.textContent).toContain("Resolver sugerencias, alertas, tareas, términos y preguntas");
    expect(disclosures?.textContent).toContain("recuperación durante diez días");
    expect(disclosures?.textContent).toContain("purga permanente no está disponible directamente");
    expect(disclosures?.textContent).toContain("eliminación programada");
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => resolve(read));
    expect((control as HTMLButtonElement).disabled).toBe(false);
  });
  it("refreshes actual permission state after grant and revoke without optimistic management", async () => {
    rpc.mockResolvedValueOnce(read).mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce(manage)
      .mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce(read);
    render(<SettingsConnections />);
    await screen.findByText("Solo lectura");
    fireEvent.click(screen.getByRole("button", { name: "Permitir gestionar" }));
    await screen.findByText("Puede gestionar");
    expect(rpc).toHaveBeenNthCalledWith(2, "grant_mcp_client_access", { p_oauth_client_id: client, p_access_level: "manage" });
    expect(rpc).toHaveBeenNthCalledWith(3, "list_my_mcp_connections");
    fireEvent.click(screen.getByRole("button", { name: "Volver a solo lectura" }));
    await screen.findByText("Solo lectura");
    expect(rpc).toHaveBeenNthCalledWith(4, "revoke_mcp_client_access", { p_oauth_client_id: client });
    expect(rpc).toHaveBeenNthCalledWith(5, "list_my_mcp_connections");
  });
  it("does not claim management when the first-party-only grant is refused", async () => {
    rpc.mockResolvedValueOnce(read).mockResolvedValueOnce({ data: null, error: { message: "MCP_FIRST_PARTY_REQUIRED" } });
    render(<SettingsConnections />);
    await screen.findByText("Solo lectura");
    fireEvent.click(screen.getByRole("button", { name: "Permitir gestionar" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Permitir gestionar" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("Puede gestionar")).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});