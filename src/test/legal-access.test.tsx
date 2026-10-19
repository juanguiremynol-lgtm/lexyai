/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { isLegalDocumentEndVisible } from '@/lib/legal-access-policy';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), from: vi.fn(), insert: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc, from: mocks.from, auth: { getUser: mocks.getUser, getSession: mocks.getSession },
} }));
import { fetchActiveTerms, hasAcceptedCurrentTerms, recordTermsAcceptance } from '@/lib/terms-service';
import { TermsAcceptanceModal } from '@/components/legal/TermsAcceptanceModal';
import { TermsReAcceptanceGuard } from '@/components/legal/TermsReAcceptanceGuard';

const canonical = {
  terms_version: 'v1.1', terms_last_updated: '2026-10-19', terms_text: 'Términos\n\nTexto íntegro vigente.', terms_text_hash: 'terms-server-hash',
  privacy_version: 'v1.1', privacy_text: 'Privacidad\n\nAviso íntegro vigente.', privacy_text_hash: 'privacy-server-hash',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'current-user' } } });
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'current-user' } } } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'get_active_terms' ? [canonical] : false, error: null }));
  mocks.insert.mockResolvedValue({ error: null });
  mocks.from.mockImplementation(() => ({ insert: mocks.insert, select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Legal access rules', () => {
  it('does not require scrolling when all content fits', () => {
    expect(isLegalDocumentEndVisible(200, 300, 0)).toBe(true);
  });
  it('requires reaching the end for overflowing documents', () => {
    expect(isLegalDocumentEndVisible(1200, 300, 0)).toBe(false);
    expect(isLegalDocumentEndVisible(1200, 300, 900)).toBe(true);
  });
  it('does not accept a hidden zero-height document', () => {
    expect(isLegalDocumentEndVisible(0, 0, 0)).toBe(false);
  });
  it('rejects a title-only terms source instead of silently using fallback text', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...canonical, terms_text: 'TÉRMINOS Y CONDICIONES DE USO – ANDROMEDA (COLOMBIA)' }] });
    await expect(fetchActiveTerms()).rejects.toThrow('incompletos');
  });
  it('rejects a title-only privacy source', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...canonical, privacy_text: 'Política de Tratamiento de Datos Personales – ANDROMEDA' }] });
    await expect(fetchActiveTerms()).rejects.toThrow('incompletos');
  });
  it('records current user, both versions and server-derived hashes', async () => {
    expect(await recordTermsAcceptance({ checkboxTerms: true, checkboxAge: true, checkboxMarketing: false })).toEqual({ success: true });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'current-user', terms_version: 'v1.1', privacy_policy_version: 'v1.1', terms_text_hash: 'terms-server-hash', privacy_policy_text_hash: 'privacy-server-hash' }));
  });
  it('does not record acceptance without both mandatory checkboxes', async () => {
    expect((await recordTermsAcceptance({ checkboxTerms: true, checkboxAge: false, checkboxMarketing: false })).success).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('does not record another acceptance when current versions are already accepted', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'get_active_terms' ? [canonical] : true, error: null }));
    expect((await recordTermsAcceptance({ checkboxTerms: true, checkboxAge: true, checkboxMarketing: false })).success).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('does not treat a failed current-version check as acceptance or lack of acceptance', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    await expect(hasAcceptedCurrentTerms()).rejects.toThrow('Reintenta');
  });
  it('allows retry after document load fails without enabling acceptance', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    render(<TermsAcceptanceModal onAccept={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('checkbox', { name: /He leído/ });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('shows protected content after server confirms current acceptance, regardless of stale profile flag', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    render(<TermsReAcceptanceGuard><main>Authorized content</main></TermsReAcceptanceGuard>);
    await waitFor(() => expect(screen.queryByRole('main')).not.toBeNull());
    expect(mocks.from).not.toHaveBeenCalledWith('profiles');
  });
});