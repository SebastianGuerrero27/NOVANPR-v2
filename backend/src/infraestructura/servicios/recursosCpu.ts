import fs from 'fs';
import os from 'os';
import { cpuMotorAnpr } from './servicioAnpr';

/**
 * Uso de CPU medido directamente, sin Prometheus ni cAdvisor (retirados del despliegue):
 *   equipo   toda la máquina que ejecuta los contenedores (/proc/stat; en Docker Desktop, la máquina
 *            virtual de Docker: todos los contenedores, no los programas de Windows)
 *   backend  el contenedor de esta API (cgroup v2, la cifra de docker stats) o, fuera de Docker, su proceso
 *   anpr     el contenedor del motor, que lo informa en su /status
 * Todo en % de la capacidad total del equipo (todos sus núcleos lógicos). El intervalo es el que pasó
 * desde la consulta anterior (el panel consulta cada 15 s); la primera vez, medio segundo.
 */
const SERVICIOS = ['equipo', 'backend', 'anpr'] as const;

export type ServicioCpu = typeof SERVICIOS[number];

export interface MetricaCpu {
  servicio: ServicioCpu;
  uso_pct: number | null;
}

type Lector = (ruta: string) => string;

interface MuestraEquipo { activo: number; total: number }
interface MuestraProceso { cpuUs: number; t: bigint }

/** Después de este tiempo sin consultas, la muestra anterior ya no representa el uso actual */
const MUESTRA_VIGENTE_MS = 60_000;
const ESPERA_PRIMERA_MS = 500;

const leerArchivo: Lector = ruta => fs.readFileSync(ruta, 'utf8');

let anterior: { equipo: MuestraEquipo | null; backend: MuestraProceso; hora: number } | null = null;

/** Primera línea de /proc/stat: tiempos acumulados de todas las CPU (null fuera de Linux). */
export function leerEquipo(leer: Lector = leerArchivo): MuestraEquipo | null {
  try {
    const campos = leer('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    if (campos.length < 4 || campos.some(n => !Number.isFinite(n))) return null;
    const [usuario, nice, sistema, inactivo, espera = 0, irq = 0, softirq = 0, robado = 0] = campos;
    const libre = inactivo + espera;
    const activo = usuario + nice + sistema + irq + softirq + robado;
    return { activo, total: activo + libre };
  } catch {
    return null;
  }
}

/** Microsegundos de CPU acumulados por este contenedor (cgroup v2), o null fuera de un contenedor. */
export function leerContenedorUs(leer: Lector = leerArchivo): number | null {
  try {
    const linea = leer('/sys/fs/cgroup/cpu.stat').split('\n').find(l => l.startsWith('usage_usec '));
    const valor = Number(linea?.split(/\s+/)[1]);
    return linea && Number.isFinite(valor) ? valor : null;
  } catch {
    return null;
  }
}

const muestraBackend = (leer: Lector): MuestraProceso => {
  const proceso = process.cpuUsage();
  return { cpuUs: leerContenedorUs(leer) ?? proceso.user + proceso.system, t: process.hrtime.bigint() };
};

const porcentaje = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

export async function usoCpuSistema(dependencias: {
  leer?: Lector;
  cpuMotor?: () => Promise<number | null>;
  esperar?: (ms: number) => Promise<void>;
} = {}) {
  const leer = dependencias.leer ?? leerArchivo;
  const esperar = dependencias.esperar ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const nucleos = Math.max(1, os.cpus().length);
  if (!anterior || Date.now() - anterior.hora > MUESTRA_VIGENTE_MS) {
    anterior = { equipo: leerEquipo(leer), backend: muestraBackend(leer), hora: Date.now() };
    await esperar(ESPERA_PRIMERA_MS);
  }
  const [equipo, backend, motor] = [leerEquipo(leer), muestraBackend(leer), await (dependencias.cpuMotor ?? cpuMotorAnpr)()];

  let usoEquipo: number | null = null;
  if (equipo && anterior.equipo && equipo.total > anterior.equipo.total) {
    usoEquipo = porcentaje(((equipo.activo - anterior.equipo.activo) / (equipo.total - anterior.equipo.total)) * 100);
  }
  const transcurridoUs = Number(backend.t - anterior.backend.t) / 1000;
  const cpuUs = backend.cpuUs - anterior.backend.cpuUs;
  const usoBackend = transcurridoUs > 0 ? porcentaje((cpuUs / transcurridoUs / nucleos) * 100) : null;
  anterior = { equipo, backend, hora: Date.now() };

  const valores: Record<ServicioCpu, number | null> = { equipo: usoEquipo, backend: usoBackend, anpr: motor === null ? null : porcentaje(motor) };
  return {
    cores_host: nucleos,
    generado: new Date().toISOString(),
    servicios: SERVICIOS.map(servicio => ({ servicio, uso_pct: valores[servicio] })),
  };
}

/** Solo para pruebas: olvida la muestra anterior. */
export function reiniciarMuestrasCpu() {
  anterior = null;
}
