import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api from '../src/infraestructura/api';

const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; sessionStorage.clear(); });

describe('Recuperación de lecturas HTTP', () => {
  it('reintenta GET transitorios y devuelve la respuesta cuando se recupera el servidor', async () => {
    let llamadas = 0;
    const adapter: AxiosAdapter = async config => {
      if (++llamadas < 3) throw new AxiosError('offline', 'ERR_NETWORK', config);
      return { status: 200, statusText: 'OK', data: 'recuperado', headers: {}, config };
    };
    api.defaults.adapter = adapter;
    expect((await api.get('/auth/estado')).data).toBe('recuperado');
    expect(llamadas).toBe(3);
  }, 10000);
  it.each(['post', 'put', 'patch', 'delete'])('no duplica una escritura %s ante un error de conexión', async method => {
    const adapter = vi.fn(async config => { throw new AxiosError('offline', 'ERR_NETWORK', config); });
    api.defaults.adapter = adapter;
    await expect(api.request({ url: '/detecciones/1/salida', method })).rejects.toSatisfy(axios.isAxiosError);
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
