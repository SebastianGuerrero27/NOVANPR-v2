/** Una pestaña abierta antes de actualizar el sistema detecta la versión nueva y ofrece recargar. */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useVersionNueva } from '../src/aplicacion/hooks';

afterEach(() => { document.head.innerHTML = ''; vi.unstubAllGlobals(); });
const cargar = (src: string) => { const s = document.createElement('script'); s.type = 'module'; s.src = src; document.head.appendChild(s); };
const servir = (html: string) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => html }));

it('avisa cuando el servidor publica otro paquete principal', async () => {
  cargar('/assets/index-AAA111.js');
  servir('<script type="module" crossorigin src="/assets/index-BBB222.js"></script>');
  const { result } = renderHook(() => useVersionNueva(20));
  await waitFor(() => expect(result.current).toBe(true));
});

it('no avisa con la misma versión ni en desarrollo', async () => {
  cargar('/assets/index-AAA111.js');
  servir('<script type="module" crossorigin src="/assets/index-AAA111.js"></script>');
  const { result, unmount } = renderHook(() => useVersionNueva(20));
  await new Promise(r => setTimeout(r, 80));
  expect(result.current).toBe(false);
  unmount();

  document.head.innerHTML = '';
  cargar('/src/main.tsx');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  renderHook(() => useVersionNueva(20));
  await new Promise(r => setTimeout(r, 80));
  expect(fetch).not.toHaveBeenCalled();
});
