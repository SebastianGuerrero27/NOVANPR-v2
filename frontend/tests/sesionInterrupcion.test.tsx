import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { get, desvincular } = vi.hoisted(() => ({ get: vi.fn(), desvincular: vi.fn() }));
vi.mock('../src/infraestructura/api', () => ({
  default: { get }, EVENTO_SESION_EXPIRADA: 'anpr:sesion-expirada',
  leerToken: () => sessionStorage.getItem('anpr_token'),
  guardarToken: (t: string | null) => t ? sessionStorage.setItem('anpr_token', t) : sessionStorage.removeItem('anpr_token'),
  respuestaError: (e: { response?: unknown }) => e.response, cuerpoError: () => undefined,
}));
vi.mock('../src/infraestructura/push', () => ({ desvincularPush: desvincular }));
import { AuthProvider, useAuth } from '../src/aplicacion/AuthContext';
const Estado = () => { const a = useAuth(); return <div>{a.user?.nombre ?? (a.loading ? a.errorSesion ?? 'Cargando' : 'Sin sesión')}</div>; };

describe('Sesión ante una interrupción del backend', () => {
  beforeEach(() => {
    vi.useFakeTimers(); get.mockReset(); desvincular.mockReset(); sessionStorage.clear();
    sessionStorage.setItem('anpr_token', `x.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.x`);
  });
  afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });
  it('conserva el token durante un error de red y recupera al usuario al volver la API', async () => {
    get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { user: { nombre: 'Ana' } } });
    await act(async () => { render(<AuthProvider><Estado /></AuthProvider>); });
    expect(screen.getByText(/Reintentando automáticamente/)).toBeInTheDocument();
    expect(sessionStorage.getItem('anpr_token')).not.toBeNull();
    expect(desvincular).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });
  it('sí cierra una sesión rechazada por el servidor', async () => {
    get.mockRejectedValue({ response: { status: 401 } });
    await act(async () => { render(<AuthProvider><Estado /></AuthProvider>); });
    expect(sessionStorage.getItem('anpr_token')).toBeNull();
    expect(screen.getByText('Sin sesión')).toBeInTheDocument();
  });
});
