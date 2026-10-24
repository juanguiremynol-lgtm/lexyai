/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), details: vi.fn(), approve: vi.fn(), deny: vi.fn(), follow: vi.fn(), authChange: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: m.rpc, auth: { getUser: m.getUser, onAuthStateChange: (f: unknown) => { m.authChange(f); return { data: { subscription: { unsubscribe: vi.fn() } } }; }, oauth: { getAuthorizationDetails: m.details, approveAuthorization: m.approve, denyAuthorization: m.deny } } } }));
vi.mock("@/lib/mcp-consent", async importOriginal => ({ ...await importOriginal<object>(), followAuthorizationCallback: m.follow }));
import OAuthConsent from "@/pages/OAuthConsent";
const client = "00000000-0000-0000-0000-000000000041";
let level = "read";
let failSave = false;
let failRead = false;
let wrong = false;
let scope = "openid email profile";
const mount = () => render(<MemoryRouter initialEntries={["/.lovable/oauth/consent?authorization_id=request"]}><OAuthConsent /></MemoryRouter>);
beforeEach(() => {
  vi.resetAllMocks(); level = "read"; failSave = false; failRead = false; wrong = false; scope = "openid email profile";
  m.getUser.mockResolvedValue({ data: { user: { id: "owner", email: "fixture@example.invalid" } }, error: null });
  m.details.mockResolvedValue({ data: { authorization_id: "request", client: { id: client, name: "Fixture AI" }, user: { id: "owner" }, scope: "openid email profile" }, error: null });
  m.approve.mockResolvedValue({ data: { redirect_url: "https://client.invalid/callback?code=fixture" }, error: null });
  m.deny.mockResolvedValue({ data: { redirect_url: "https://client.invalid/callback?error=access_denied" }, error: null });
  m.rpc.mockImplementation(async (name: string) => {
    if (name === "mcp_native_authorization_identity") return { data: { client_id: client, client_name: "Fixture AI", scope }, error: null };
    if (name === "list_my_mcp_connections") return { data: [{ oauth_client_id: wrong ? "wrong" : client, access_level: level }], error: failRead ? { message: "failure" } : null };
    if (failSave) return { data: null, error: { message: "failure" } };
    level = name === "grant_mcp_client_access" ? "manage" : "read";
    return { data: { ok: true }, error: null };
  });
});
afterEach(cleanup);
async function ready() { await screen.findByRole("button", { name: "Conectar con solo lectura" }); }
async function manage() { fireEvent.click(screen.getByRole("radio", { name: /Consultar y gestionar/ })); fireEvent.click(screen.getByRole("button", { name: "Conectar y permitir gestión" })); }
describe("native consent permission ordering", () => {
  it("defaults to read and revokes earlier management before callback", async () => { level = "manage"; mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Conectar con solo lectura" })); await waitFor(() => expect(m.follow).toHaveBeenCalledTimes(1)); expect(level).toBe("read"); expect(m.approve).toHaveBeenCalledWith("request", { skipBrowserRedirect: true }); expect(m.rpc).toHaveBeenCalledWith("revoke_mcp_client_access", { p_oauth_client_id: client }); });
  it("saves only explicit management and verifies it", async () => { mount(); await ready(); await manage(); await waitFor(() => expect(m.follow).toHaveBeenCalledTimes(1)); expect(level).toBe("manage"); expect(m.rpc).toHaveBeenCalledWith("grant_mcp_client_access", { p_oauth_client_id: client, p_access_level: "manage" }); });
  it("shows choice for redirect-only consent and never reapproves", async () => { m.details.mockResolvedValue({ data: { redirect_url: "https://client.invalid/callback?code=fixture" }, error: null }); mount(); await ready(); expect(m.follow).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Conectar con solo lectura" })); await waitFor(() => expect(m.follow).toHaveBeenCalledTimes(1)); expect(m.approve).not.toHaveBeenCalled(); });
  it("approval failure makes no permission mutation", async () => { m.approve.mockResolvedValue({ data: null, error: { message: "failure" } }); mount(); await ready(); await manage(); await screen.findByRole("alert"); expect(m.rpc.mock.calls.every(([name]) => name === "mcp_native_authorization_identity")).toBe(true); expect(m.follow).not.toHaveBeenCalled(); });
  it("grant failure stays and retries without approving again", async () => { failSave = true; mount(); await ready(); await manage(); await screen.findByRole("alert"); expect(m.follow).not.toHaveBeenCalled(); failSave = false; fireEvent.click(screen.getByRole("button", { name: "Reintentar guardar y verificar permiso" })); await waitFor(() => expect(m.follow).toHaveBeenCalledTimes(1)); expect(m.approve).toHaveBeenCalledTimes(1); });
  it("failed read fallback never redirects", async () => { failSave = true; mount(); await ready(); await manage(); await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Continuar solo lectura" })); await waitFor(() => expect(m.rpc).toHaveBeenCalledWith("revoke_mcp_client_access", { p_oauth_client_id: client })); expect(m.follow).not.toHaveBeenCalled(); expect(m.approve).toHaveBeenCalledTimes(1); });
  it.each(["wrong client", "read error"])("does not redirect on %s readback", async kind => { wrong = kind === "wrong client"; failRead = kind === "read error"; mount(); await ready(); await manage(); await screen.findByRole("alert"); expect(m.follow).not.toHaveBeenCalled(); });
  it("rejects SDK identity disagreement", async () => { m.details.mockResolvedValue({ data: { client: { id: "foreign" } }, error: null }); mount(); await screen.findByRole("alert"); expect(screen.queryByRole("radio")).toBeNull(); expect(m.approve).not.toHaveBeenCalled(); });
  it("duplicates cannot approve twice", async () => { mount(); await ready(); const button = screen.getByRole("button", { name: "Conectar con solo lectura" }); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(m.follow).toHaveBeenCalledTimes(1)); expect(m.approve).toHaveBeenCalledTimes(1); });
  it("successful explicit read fallback revokes previous management", async () => { failSave = true; level = "manage"; mount(); await ready(); await manage(); await screen.findByRole("alert"); failSave = false; fireEvent.click(screen.getByRole("button", { name: "Continuar solo lectura" })); await waitFor(() => expect(m.follow).toHaveBeenCalledTimes(1)); expect(level).toBe("read"); expect(m.approve).toHaveBeenCalledTimes(1); });
  it("narrow read scopes cannot select management", async () => { scope = "openid andromeda:read"; mount(); await ready(); expect(screen.getByRole("radio", { name: /Consultar y gestionar/ }).getAttribute("disabled")).not.toBeNull(); });
  it("missing client identity disables all decisions", async () => { m.rpc.mockResolvedValue({ data: {}, error: null }); mount(); await screen.findByRole("alert"); expect(screen.queryByRole("radio")).toBeNull(); });
  it("resets pending callback on account change", async () => { failSave = true; mount(); await ready(); await manage(); await screen.findByRole("alert"); m.getUser.mockResolvedValue({ data: { user: { id: "second", email: "second@example.invalid" } }, error: null }); m.details.mockResolvedValue({ data: { client: { id: client }, user: { id: "second" } }, error: null }); act(() => m.authChange.mock.calls[0][0]("SIGNED_IN", { user: { id: "second" } })); await screen.findByText("Cuenta verificada: second@example.invalid"); await ready(); expect(screen.getByRole("radio", { name: /Solo consultar/ }).getAttribute("aria-checked")).toBe("true"); expect(m.follow).not.toHaveBeenCalled(); });
  it("cancel never grants", async () => { mount(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); await waitFor(() => expect(m.deny).toHaveBeenCalledTimes(1)); expect(m.approve).not.toHaveBeenCalled(); expect(m.rpc.mock.calls.every(([name]) => name === "mcp_native_authorization_identity")).toBe(true); });
});
