import { leerContenedorUs, leerEquipo, reiniciarMuestrasCpu, usoCpuSistema } from '../../infraestructura/servicios/recursosCpu';

/** /proc/stat con los tiempos acumulados dados (usuario, nice, sistema, inactivo, espera…). */
const stat = (...campos: number[]) => `cpu  ${campos.join(' ')}\ncpu0 1 2 3 4\n`;
const cgroup = (us: number) => `usage_usec ${us}\nuser_usec 1\nsystem_usec 1\n`;

describe('uso de CPU medido sin Prometheus', () => {
  afterEach(() => reiniciarMuestrasCpu());

  it('lee los tiempos del equipo de /proc/stat (la espera de disco cuenta como libre)', () => {
    expect(leerEquipo(() => stat(100, 0, 50, 800, 50, 0, 0, 0))).toEqual({ activo: 150, total: 1000 });
    expect(leerEquipo(() => { throw new Error('ENOENT'); })).toBeNull();
    expect(leerEquipo(() => 'basura')).toBeNull();
  });

  it('lee la CPU acumulada del contenedor del cgroup', () => {
    expect(leerContenedorUs(() => cgroup(2_500_000))).toBe(2_500_000);
    expect(leerContenedorUs(() => { throw new Error('ENOENT'); })).toBeNull();
    expect(leerContenedorUs(() => 'user_usec 4\n')).toBeNull();
  });

  it('calcula el equipo, el backend y el motor en % de la capacidad total', async () => {
    const lecturas = [stat(100, 0, 50, 800, 50), stat(300, 0, 150, 1000, 50)];
    const r = await usoCpuSistema({
      leer: ruta => ruta === '/proc/stat' ? lecturas.shift() ?? stat(300, 0, 150, 1000, 50) : cgroup(1_000),
      cpuMotor: async () => 37.456,
      esperar: async () => undefined,
    });
    const valor = (s: string) => r.servicios.find(x => x.servicio === s)?.uso_pct;
    expect(r.servicios.map(s => s.servicio)).toEqual(['equipo', 'backend', 'anpr']);
    // Δactivo 300 de Δtotal 500
    expect(valor('equipo')).toBe(60);
    expect(valor('anpr')).toBe(37.5);
    // el cgroup no avanzó entre las dos muestras
    expect(valor('backend')).toBe(0);
    expect(r.cores_host).toBeGreaterThan(0);
  });

  it('sin el motor ni /proc/stat no inventa valores', async () => {
    const r = await usoCpuSistema({ leer: () => { throw new Error('ENOENT'); }, cpuMotor: async () => null, esperar: async () => undefined });
    expect(r.servicios.find(s => s.servicio === 'equipo')?.uso_pct).toBeNull();
    expect(r.servicios.find(s => s.servicio === 'anpr')?.uso_pct).toBeNull();
    // fuera de un contenedor mide su propio proceso
    expect(r.servicios.find(s => s.servicio === 'backend')?.uso_pct).not.toBeNull();
  });
});
