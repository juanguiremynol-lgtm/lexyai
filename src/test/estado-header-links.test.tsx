// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EstadosTable } from '../pages/WorkItemDetail/tabs/EstadosTable';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
afterEach(cleanup);

it('keeps an order and an unclassified PDF clickable separately from the estado title', () => {
  render(<EstadosTable rows={[{
    key: 'one', fuente: 'PP', title: 'Estado de prueba', separateRoleLinks: true,
    gcs_url_auto: 'https://storage.googleapis.com/bucket/auto.pdf',
    unclassifiedUrl: 'https://storage.googleapis.com/bucket/otro.pdf',
  }]} />);
  expect(screen.queryByRole('button', { name: 'Estado de prueba' })).toBeNull();
  expect(screen.getByText('Estado de prueba')).toBeTruthy();
  expect(screen.getByRole('link', { name: /auto/i }).getAttribute('href')).toMatch(/auto.pdf$/);
  expect(screen.getByRole('link', { name: /tipo sin verificar/i }).getAttribute('href')).toMatch(/otro.pdf$/);
});
