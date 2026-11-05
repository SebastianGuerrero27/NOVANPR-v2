import { conCacheBreve, conCachePorClave } from '../../infraestructura/servicios/cacheBreve';

describe('Memoria breve de consultas pesadas', () => {
  beforeEach(() => jest.useFakeTimers({ now: 1_000_000, doNotFake: ['nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('las peticiones simultáneas comparten una sola consulta', async () => {
    let resolver!: (v: number) => void;
    const calcular = jest.fn(() => new Promise<number>(r => { resolver = r; }));
    const cacheada = conCacheBreve(calcular, { vigenciaMs: 2000 });
    const pedidos = Array.from({ length: 50 }, () => cacheada());
    await Promise.resolve();
    resolver(7);
    expect(await Promise.all(pedidos)).toEqual(Array(50).fill(7));
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('reutiliza el valor durante su vigencia y vuelve a consultar al vencer', async () => {
    const calcular = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const cacheada = conCacheBreve(calcular, { vigenciaMs: 2000 });
    expect(await cacheada()).toBe(1);
    jest.setSystemTime(1_001_999);
    expect(await cacheada()).toBe(1);
    jest.setSystemTime(1_002_001);
    expect(await cacheada()).toBe(2);
  });

  it('un error no se guarda: la siguiente petición lo intenta de nuevo', async () => {
    const calcular = jest.fn().mockRejectedValueOnce(new Error('base caída')).mockResolvedValueOnce(5);
    const cacheada = conCacheBreve(calcular, { vigenciaMs: 2000 });
    await expect(cacheada()).rejects.toThrow('base caída');
    expect(await cacheada()).toBe(5);
  });

  it('con servirVencidoMs entrega al instante el valor vencido y recalcula en segundo plano', async () => {
    let resolver!: (v: number) => void;
    const calcular = jest.fn().mockResolvedValueOnce(1).mockImplementationOnce(() => new Promise<number>(r => { resolver = r; }));
    const cacheada = conCacheBreve(calcular, { vigenciaMs: 1000, servirVencidoMs: 5000 });
    expect(await cacheada()).toBe(1);
    jest.setSystemTime(1_002_000);
    expect(await cacheada()).toBe(1);
    expect(calcular).toHaveBeenCalledTimes(2);
    resolver(9);
    await new Promise(process.nextTick);
    expect(await cacheada()).toBe(9);
  });

  it('un valor demasiado viejo no se sirve: se espera el recálculo', async () => {
    const calcular = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const cacheada = conCacheBreve(calcular, { vigenciaMs: 1000, servirVencidoMs: 5000 });
    await cacheada();
    jest.setSystemTime(1_007_000);
    expect(await cacheada()).toBe(2);
  });

  it('un fallo del recálculo en segundo plano no rompe a quien pidió', async () => {
    const calcular = jest.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('falló'));
    const cacheada = conCacheBreve(calcular, { vigenciaMs: 1000, servirVencidoMs: 5000 });
    await cacheada();
    jest.setSystemTime(1_002_000);
    expect(await cacheada()).toBe(1);
  });

  it('por clave: filtros distintos no se mezclan y el número de claves tiene tope', async () => {
    const calcular = jest.fn(async (f: string) => f.toUpperCase());
    const cacheada = conCachePorClave(calcular, f => f, { vigenciaMs: 2000 }, 2);
    expect(await cacheada('a')).toBe('A');
    expect(await cacheada('b')).toBe('B');
    expect(await cacheada('a')).toBe('A');
    expect(calcular).toHaveBeenCalledTimes(2);
    await cacheada('c');
    await cacheada('a');
    expect(calcular).toHaveBeenCalledTimes(4);
  });
});
