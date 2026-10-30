import { type Actor, errorConflicto, errorNoEncontrado, errorValidacion, type PuertoAuditoria } from './comun';
import { leerCambiosConfiguracion, type ReglaParametro } from '../dominio/configuracion';
import {
  cambiosCorreoSaliente, type DatosCorreoSaliente, explicarErrorSmtp, leerCorreoSaliente, PERFILES_SMTP, seguridadDePuerto,
} from '../dominio/correoSaliente';
import { validarEmail } from '../dominio/validacion';

/**
 * Casos de uso de la configuración del sistema: consultar los parámetros editables (valor
 * vigente y origen) con los datos del entorno, y guardar cambios. Cada valor se valida según el
 * tipo declarado del parámetro (dominio/configuracion.ts) antes de escribir nada; solo se
 * guardan y auditan los que cambian, y al final se recargan los valores en memoria.
 *
 * Correo saliente (SMTP): consultar (sin la contraseña), guardar (la contraseña se cifra y,
 * vacía, se conserva la guardada), quitar (rigen otra vez las variables SMTP_*) y enviar una
 * prueba. La verificación de correo en el registro no se puede exigir sin un correo saliente:
 * las cuentas nuevas no recibirían el enlace para activarse.
 */

/** Parámetro tal como lo entrega la API: su definición, el valor vigente y su origen. */
export type ParametroDTO = ReglaParametro & { valor: string } & Record<string, unknown>;

export interface RepositorioConfiguracion {
  /** Definición (tipo, rango u opciones) de cada parámetro editable */
  definiciones(): readonly ReglaParametro[];
  /** Parámetros con el valor vigente y su origen (sistema, entorno u omisión) */
  listar(): ParametroDTO[];
  guardar(clave: string, valor: string, usuarioId: number): Promise<void>;
  /** Vuelve a leer los valores guardados: el resto del sistema los consulta en memoria */
  recargar(): Promise<void>;
}

/** Datos del entorno de ejecución que la pantalla muestra en modo de solo lectura. */
export interface PuertoEntorno {
  describir(): Promise<Record<string, unknown>>;
}

/** Correo saliente guardado (la contraseña solo cifrada). */
export interface CorreoGuardado extends Omit<DatosCorreoSaliente, 'clave'> {
  /** false si ninguna clave de cifrado configurada descifra la contraseña: hay que volver a escribirla */
  claveLegible: boolean;
  actualizadoPor: string | null;
  fechaActualizacion: Date | string | null;
  ultimaPrueba: Date | string | null;
  ultimaPruebaOk: boolean | null;
  ultimaPruebaDetalle: string | null;
}

export interface RepositorioCorreoSaliente {
  obtener(): Promise<CorreoGuardado | null>;
  /** claveCifrada null conserva la guardada */
  guardar(datos: Omit<DatosCorreoSaliente, 'clave'>, claveCifrada: string | null, usuarioId: number): Promise<void>;
  eliminar(): Promise<void>;
  registrarPrueba(ok: boolean, detalle: string): Promise<void>;
}

/** El correo que usa el resto del sistema (verificación, recuperación, alarmas). */
export interface PuertoCorreoSaliente {
  /** De dónde sale hoy el correo: esta pantalla, las variables SMTP_* del servidor o ninguno */
  origen(): 'sistema' | 'entorno' | null;
  /** true si el servidor define SMTP_USER y SMTP_PASSWORD (respaldo al quitar la cuenta de esta pantalla) */
  hayCuentaDelServidor(): boolean;
  /** Vuelve a leer la cuenta guardada */
  recargar(): Promise<void>;
  probar(destino: string, nombre: string): Promise<{ ok: boolean; error?: string }>;
  cifrar(clave: string): string;
}

export interface DependenciasConfiguracion {
  repositorio: RepositorioConfiguracion;
  entorno: PuertoEntorno;
  auditoria: PuertoAuditoria;
  correo: { repositorio: RepositorioCorreoSaliente; servicio: PuertoCorreoSaliente };
}

const VERIFICACION_CORREO = 'registro_verificacion_email_habilitada';
const SIN_CORREO = 'Configure el correo saliente (SMTP) antes de exigir la verificación de correo: sin él, las cuentas nuevas no recibirían el enlace para activarse.';

const cuerpo = (entrada: unknown): Record<string, unknown> =>
  (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada as Record<string, unknown> : {});

export function casosConfiguracion(d: DependenciasConfiguracion) {
  const verificacionExigida = () => d.repositorio.listar().find(p => p.clave === VERIFICACION_CORREO)?.valor === 'true';

  /** Correo saliente para la pantalla: nunca la contraseña, solo si hay una guardada. */
  async function consultarCorreo() {
    const g = await d.correo.repositorio.obtener();
    return {
      origen_vigente: d.correo.servicio.origen(),
      cuenta_del_servidor: d.correo.servicio.hayCuentaDelServidor(),
      verificacion_exigida: verificacionExigida(),
      perfiles: PERFILES_SMTP,
      guardado: g && {
        servidor: g.servidor, puerto: g.puerto, seguridad: seguridadDePuerto(g.puerto), usuario: g.usuario,
        remitente_nombre: g.remitenteNombre, remitente_correo: g.remitenteCorreo, habilitado: g.habilitado,
        clave_guardada: true, clave_legible: g.claveLegible,
        actualizado_por: g.actualizadoPor, fecha_actualizacion: g.fechaActualizacion,
        ultima_prueba: g.ultimaPrueba ? { fecha: g.ultimaPrueba, ok: g.ultimaPruebaOk, detalle: g.ultimaPruebaDetalle } : null,
      },
    };
  }

  /** Quitar o deshabilitar la cuenta de esta pantalla no puede dejar la verificación sin correo. */
  function exigirRespaldo() {
    if (verificacionExigida() && !d.correo.servicio.hayCuentaDelServidor()) {
      throw errorConflicto('La verificación de correo está activa y el servidor no tiene otra cuenta SMTP: desactive primero la verificación.');
    }
  }

  return {
    async consultar() {
      const entorno = await d.entorno.describir();
      return { parametros: d.repositorio.listar(), entorno };
    },

    /** Guarda los valores que cambian (todos validados antes); devuelve cuántos y los parámetros vigentes. */
    async guardar(valores: unknown, actor: Actor) {
      const v = leerCambiosConfiguracion(d.repositorio.definiciones(), valores);
      if (!v.ok) throw errorValidacion(v.error);
      const previos = new Map(d.repositorio.listar().map(p => [p.clave, p.valor]));
      const cambiados = v.valor.filter(([clave, valor]) => previos.get(clave) !== valor);
      if (cambiados.some(([clave, valor]) => clave === VERIFICACION_CORREO && valor === 'true') && !d.correo.servicio.origen()) {
        throw errorValidacion(SIN_CORREO);
      }
      for (const [clave, valor] of cambiados) {
        await d.repositorio.guardar(clave, valor, actor.id);
        await d.auditoria.operacion(actor, 'CONFIGURACION', 'configuracion', null, `${clave}: ${previos.get(clave)} → ${valor}`);
      }
      await d.repositorio.recargar();
      return { cambiados: cambiados.length, parametros: d.repositorio.listar() };
    },

    consultarCorreo,

    /** Alta o edición del correo saliente; la contraseña vacía conserva la guardada (si se puede descifrar). */
    async guardarCorreo(entrada: unknown, actor: Actor) {
      const actual = await d.correo.repositorio.obtener();
      const v = leerCorreoSaliente(cuerpo(entrada), Boolean(actual?.claveLegible));
      if (!v.ok) throw errorValidacion(v.error);
      if (!v.valor.habilitado && actual?.habilitado !== false) exigirRespaldo();
      const { clave, ...datos } = v.valor;
      await d.correo.repositorio.guardar(datos, clave ? d.correo.servicio.cifrar(clave) : null, actor.id);
      const cambios = cambiosCorreoSaliente(actual, v.valor);
      await d.auditoria.operacion(actor, 'CONFIGURACION_CORREO', 'configuracion', null, `Correo saliente: ${cambios.join(', ') || 'sin cambios'}`);
      await d.correo.servicio.recargar();
      return consultarCorreo();
    },

    /** Quita la cuenta de esta pantalla: vuelven a regir las variables SMTP_* del servidor. */
    async eliminarCorreo(actor: Actor) {
      const actual = await d.correo.repositorio.obtener();
      if (!actual) throw errorNoEncontrado('No hay un correo saliente guardado en esta pantalla.');
      if (actual.habilitado) exigirRespaldo();
      await d.correo.repositorio.eliminar();
      await d.auditoria.operacion(actor, 'CONFIGURACION_CORREO', 'configuracion', null, `Correo saliente quitado (${actual.usuario})`);
      await d.correo.servicio.recargar();
      return consultarCorreo();
    },

    /** Envía un correo de prueba con la cuenta vigente (por omisión, a quien la pide). */
    async probarCorreo(entrada: unknown, actor: Actor) {
      const b = cuerpo(entrada);
      const destino = validarEmail(b.destino === undefined || b.destino === '' ? actor.email : b.destino, 'Correo de destino');
      if (!destino.ok) throw errorValidacion(destino.error);
      const origen = d.correo.servicio.origen();
      if (!origen) throw errorConflicto('No hay correo saliente configurado: guarde la cuenta SMTP antes de probarla.');
      const r = await d.correo.servicio.probar(destino.valor, actor.nombre);
      const detalle = r.ok ? `Correo de prueba enviado a ${destino.valor}.` : explicarErrorSmtp(r.error ?? '');
      if (origen === 'sistema') await d.correo.repositorio.registrarPrueba(r.ok, detalle);
      await d.auditoria.operacion(actor, 'CORREO_PRUEBA', 'configuracion', null,
        `${r.ok ? 'Enviado' : 'Fallido'} a ${destino.valor} (${origen === 'sistema' ? 'cuenta de Configuración' : 'variables SMTP_*'})`);
      return { ok: r.ok, detalle, correo: await consultarCorreo() };
    },
  };
}

export type CasosConfiguracion = ReturnType<typeof casosConfiguracion>;
