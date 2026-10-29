import {
  ACTOR_SISTEMA, type Actor, errorConflicto, errorNoEncontrado, errorProhibido, errorValidacion, type PuertoAuditoria, type PuertoEventos,
} from './comun';
import {
  camposModificados, type DefinicionLista, describirRegistro, leerRegistroLista, type RegistroLista,
} from '../dominio/listas';
import { validarEntero, validarTexto, validarPlaca } from '../dominio/validacion';
import { type Rol, tienePermiso } from '../dominio/permisos';
import { leerFilasImportacion } from '../dominio/importacionPermisos';
import { LISTA_BLANCA } from '../dominio/listas';

/**
 * Casos de uso de las listas de control (lista blanca y lista negra):
 * consultar, ver detalle, registrar (o reactivar), editar y retirar (baja lógica; motivo opcional).
 * Toda alta, edición o retiro queda en la auditoría y se difunde en tiempo real.
 */

/** Registro tal como lo entrega la API (con vigencia calculada y horario interpretado). */
export type RegistroListaDTO = Record<string, any> & { id: number; placa: string | null };

export interface RepositorioListas {
  asignarPlaca?(id: number, placa: string): Promise<boolean>;
  listar(def: DefinicionLista, usuarioId?: number): Promise<RegistroListaDTO[]>;
  obtener(def: DefinicionLista, id: number): Promise<RegistroListaDTO | null>;
  /** Fila guardada y activa (para comparar en la edición) */
  obtenerActivo(def: DefinicionLista, id: number): Promise<Record<string, any> | null>;
  buscarPorPlaca(def: DefinicionLista, placa: string): Promise<{ id: number; activo: boolean; registrado_por?: number | null } | null>;
  /** Evita que una persona tenga más de un permiso activo con la misma cédula. */
  existeOtraConCedula?(def: DefinicionLista, cedula: string, idExcluido?: number): Promise<boolean>;
  existeOtraConPlaca(def: DefinicionLista, placa: string, idExcluido: number): Promise<boolean>;
  crear(def: DefinicionLista, r: RegistroLista, usuarioId: number, solicitudId?: number): Promise<number>;
  reactivar(def: DefinicionLista, id: number, r: RegistroLista, usuarioId: number, solicitudId?: number): Promise<void>;
  actualizar(def: DefinicionLista, id: number, r: RegistroLista): Promise<void>;
  /** Baja lógica; devuelve la placa retirada o null si no estaba activa */
  retirar(def: DefinicionLista, id: number): Promise<string | null>;
  /** Permisos de la lista blanca de todos los usuarios (o de uno), activos, retirados o todos, con `activo` */
  registroPermisos(f: { usuarioId: number | null; estado: EstadoRegistroPermisos }): Promise<RegistroListaDTO[]>;
  /** Gestores de permisos y cualquier usuario que haya registrado alguno */
  usuariosPadron(): Promise<{ id: number; nombre: string; email: string; rol: string; estado: string }[]>;
  /** Vuelve a activar un registro retirado tal como estaba; false si no estaba retirado */
  restaurar(def: DefinicionLista, id: number): Promise<boolean>;
  /**
   * Borra el registro si está retirado o vencido y ningún paso lo referencia (desvincula sus
   * solicitudes); devuelve las rutas de su evidencia, o null si no cumplía las condiciones.
   */
  eliminarDefinitivo(def: DefinicionLista, id: number): Promise<{ rutas: (string | null)[] } | null>;
  /** Retira (baja lógica) los registros activos cuya fecha de vencimiento ya pasó (día local); devuelve cuáles */
  retirarVencidos(def: DefinicionLista): Promise<{ id: number; nombre: string; vence: Date | string }[]>;
}

export type EstadoRegistroPermisos = 'activos' | 'retirados' | 'todos';

/** Permisos otorgados por un usuario, para el registro de permisos del administrador. */
export interface ResumenPermisosUsuario {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  estado: string;
  total: number;
  activos: number;
  vigentes: number;
  por_vencer: number;
  vencidos: number;
  retirados: number;
  sin_placa: number;
  ultimo_registro: string | null;
}

/** Avisos al personal cuando cambia una lista (p. ej. vehículo agregado a la lista blanca). */
export interface PuertoAvisosListas {
  registroAgregado(def: DefinicionLista, registro: RegistroListaDTO, actor: Actor): void | Promise<void>;
}

export interface DependenciasListas {
  repositorio: RepositorioListas;
  auditoria: PuertoAuditoria;
  eventos: PuertoEventos;
  avisos: PuertoAvisosListas;
  describirHorario: (horario: string | null) => string;
  /** Celdas (texto) de la primera hoja de un .xlsx o de un .csv, para importar permisos */
  leerHoja?: (contenido: Buffer) => Promise<string[][]>;
  /** Borra las fotos conservadas de un registro eliminado definitivamente */
  evidencia?: { eliminar(rutas: (string | null)[]): Promise<number> };
}

/** Resultado de cada fila de una importación (o de su vista previa). */
export interface ResultadoFilaImportacion {
  fila: number;
  /** Valor de la columna id de la hoja: solo referencia, no se guarda */
  id: string | null;
  propietario: string | null;
  placa: string | null;
  accion: 'crear' | 'reactivar' | 'omitir' | 'error';
  mensaje: string;
}

export type AccionGuardado = 'creado' | 'reactivado' | 'actualizado';

/** Cuántos permisos otorgó cada usuario y en qué estado están (vigencia calculada por la API). */
export function resumirPorUsuario(usuarios: { id: number; nombre: string; email: string; rol: string; estado: string }[],
  permisos: RegistroListaDTO[]): ResumenPermisosUsuario[] {
  return usuarios.map(u => {
    const propios = permisos.filter(p => Number(p.registrado_por) === u.id);
    const activos = propios.filter(p => p.activo);
    const ultimo = propios.reduce<string | null>((max, p) => {
      const f = p.fecha_registro ? new Date(p.fecha_registro).toISOString() : null;
      return f && (!max || f > max) ? f : max;
    }, null);
    return {
      ...u, total: propios.length, activos: activos.length,
      vigentes: activos.filter(p => p.vigente && !p.por_vencer).length,
      por_vencer: activos.filter(p => p.vigente && p.por_vencer).length,
      vencidos: activos.filter(p => !p.vigente).length,
      retirados: propios.length - activos.length,
      sin_placa: activos.filter(p => !p.placa).length,
      ultimo_registro: ultimo,
    };
  });
}

export function casosListas(d: DependenciasListas) {
  const difundir = (def: DefinicionLista) => d.eventos.emitir('listas:actualizadas', { lista: def.entidad });
  /** Estado de un registro de permisos: activos, retirados (desactivados) o todos. */
  const leerEstado = (valor: unknown, omision: EstadoRegistroPermisos): EstadoRegistroPermisos => {
    const estado = valor ?? omision;
    if (estado !== 'activos' && estado !== 'retirados' && estado !== 'todos') throw errorValidacion('Estado: use activos, retirados o todos.');
    return estado;
  };

  const verificarPropietario = (def: DefinicionLista, registro: Record<string, any>, actor?: Actor) => {
    if (def.tipo === 'autorizados' && actor?.rol === 'GestorPermisos' && Number(registro.registrado_por) !== actor.id) {
      throw errorProhibido('Este permiso pertenece a otro usuario. Solo puede gestionar sus propios permisos.');
    }
  };

  const validar = (def: DefinicionLista, entrada: unknown): RegistroLista => {
    const r = leerRegistroLista(def, entrada as Record<string, unknown>);
    if (!r.ok) throw errorValidacion(r.error);
    return r.valor;
  };

  /**
   * Guarda un registro ya validado: lo crea, reactiva el retirado con la misma placa o, si ya
   * está activo, lo actualiza solo cuando `actualizarSiExiste` (aprobación que amplía un permiso).
   * No audita: lo hace quien orquesta (registrar o la aprobación de una solicitud).
   */
  async function guardar(def: DefinicionLista, r: RegistroLista, actor: Actor, opciones: { solicitudId?: number; actualizarSiExiste?: boolean } = {}) {
    const previo = r.placa ? await d.repositorio.buscarPorPlaca(def, r.placa) : null;
    const cedula = def.tipo === 'autorizados' ? r.datos.cedula : null;
    if (cedula && d.repositorio.existeOtraConCedula && await d.repositorio.existeOtraConCedula(def, cedula, previo?.id)) {
      throw errorConflicto(`La cédula ${cedula} ya tiene un permiso activo en la lista blanca.`);
    }
    if (previo) verificarPropietario(def, previo, actor);
    if (previo?.activo) {
      if (!opciones.actualizarSiExiste) throw errorConflicto(`La placa ${r.placa} ya está en la ${def.nombre}.`);
      await d.repositorio.actualizar(def, previo.id, r);
      return { id: previo.id, accion: 'actualizado' as AccionGuardado };
    }
    if (previo) {
      await d.repositorio.reactivar(def, previo.id, r, actor.id, opciones.solicitudId);
      return { id: previo.id, accion: 'reactivado' as AccionGuardado };
    }
    return { id: await d.repositorio.crear(def, r, actor.id, opciones.solicitudId), accion: 'creado' as AccionGuardado };
  }

  return {
    validar,
    guardar,
    difundir,
    /** Avisa al personal de un registro agregado por otra vía (p. ej. una solicitud aprobada). */
    anunciarAlta: (def: DefinicionLista, registro: RegistroListaDTO, actor: Actor) => d.avisos.registroAgregado(def, registro, actor),

    listar: (def: DefinicionLista, actor?: Actor, soloMios = false) =>
      d.repositorio.listar(def, actor && def.tipo === 'autorizados' && (soloMios || actor.rol === 'GestorPermisos') ? actor.id : undefined),

    async obtener(def: DefinicionLista, id: number, actor?: Actor) {
      const item = await d.repositorio.obtener(def, id);
      if (!item) throw errorNoEncontrado('Registro no encontrado.');
      verificarPropietario(def, item, actor);
      return item;
    },

    async registrar(def: DefinicionLista, entrada: unknown, actor: Actor) {
      const r = validar(def, entrada);
      const { id, accion } = await guardar(def, r, actor);
      await d.auditoria.operacion(actor, accion === 'reactivado' ? 'LISTA_REACTIVADO' : 'LISTA_ALTA', def.entidad, id,
        describirRegistro(r, d.describirHorario));
      const item = (await d.repositorio.obtener(def, id))!;
      await d.avisos.registroAgregado(def, item, actor);
      difundir(def);
      return { item, accion };
    },

    async editar(def: DefinicionLista, id: number, entrada: unknown, actor: Actor) {
      const r = validar(def, entrada);
      const anterior = await d.repositorio.obtenerActivo(def, id);
      if (!anterior) throw errorNoEncontrado('Registro no encontrado.');
      verificarPropietario(def, anterior, actor);
      if (r.placa && await d.repositorio.existeOtraConPlaca(def, r.placa, id)) throw errorConflicto(`Ya existe otro registro con la placa ${r.placa}.`);
      const cedula = def.tipo === 'autorizados' ? r.datos.cedula : null;
      if (cedula && d.repositorio.existeOtraConCedula && await d.repositorio.existeOtraConCedula(def, cedula, id)) {
        throw errorConflicto(`La cédula ${cedula} ya tiene otro permiso activo en la lista blanca.`);
      }
      await d.repositorio.actualizar(def, id, r);
      const cambios = camposModificados(def, anterior, r, d.describirHorario);
      await d.auditoria.operacion(actor, 'LISTA_EDICION', def.entidad, id, `${r.placa}: ${cambios.join(', ') || 'sin cambios'}`);
      difundir(def);
      return (await d.repositorio.obtener(def, id))!;
    },

    /**
     * Retiro (baja lógica) de la lista blanca o de la lista negra, sin pedir motivo: queda en la
     * auditoría con el usuario y la placa. Un motivo enviado se valida y se anota también.
     */
    async retirar(def: DefinicionLista, id: number, motivo: unknown, actor: Actor) {
      const m = validarTexto(motivo, { etiqueta: 'Motivo del retiro', tipo: 'libre', min: 5, max: 300 });
      if (!m.ok) throw errorValidacion(m.error);
      if (def.tipo === 'autorizados' && actor.rol === 'GestorPermisos') {
        const actual = await d.repositorio.obtenerActivo(def, id);
        if (!actual) throw errorNoEncontrado('Registro no encontrado.');
        verificarPropietario(def, actual, actor);
      }
      const placa = await d.repositorio.retirar(def, id);
      if (!placa) throw errorNoEncontrado('Registro no encontrado.');
      await d.auditoria.operacion(actor, 'LISTA_RETIRO', def.entidad, id, m.valor ? `${placa} · ${m.valor}` : placa);
      difundir(def);
    },

    /**
     * Tarea programada: un permiso cuya vigencia terminó sale de la lista blanca (baja lógica). Ya
     * no concedía el paso (la decisión lo trata como vencido), pero seguía figurando en la lista.
     * Cada retiro queda en la auditoría a nombre del sistema; se puede renovar con una vigencia nueva.
     */
    async retirarVencidos() {
      const retirados = await d.repositorio.retirarVencidos(LISTA_BLANCA);
      for (const r of retirados) {
        await d.auditoria.operacion(ACTOR_SISTEMA, 'LISTA_RETIRO', LISTA_BLANCA.entidad, r.id,
          `${r.nombre} · retiro automático: la vigencia terminó el ${new Date(r.vence).toISOString().slice(0, 10)}`);
      }
      if (retirados.length) difundir(LISTA_BLANCA);
      return retirados.length;
    },

    /**
     * Eliminación definitiva de un permiso retirado o vencido (padron:supervisar). Un permiso con
     * ingresos en el historial no se elimina: los pasos lo referencian y se perdería la
     * trazabilidad de quién estaba autorizado; queda retirado. Borra también su evidencia propia.
     */
    async eliminarDefinitivo(def: DefinicionLista, id: number, actor: Actor) {
      if (def.tipo !== 'autorizados') throw errorValidacion('Solo se eliminan permisos de la lista blanca.');
      const registro = await d.repositorio.obtener(def, id);
      if (!registro) throw errorNoEncontrado('Permiso no encontrado.');
      if (registro.activo && registro.vigente) {
        throw errorConflicto('El permiso está vigente: retírelo primero. Solo se eliminan permisos retirados o vencidos.');
      }
      const ingresos = Number(registro.ingresos ?? 0);
      if (ingresos > 0) {
        throw errorConflicto(`El permiso tiene ${ingresos} ${ingresos === 1 ? 'ingreso' : 'ingresos'} en el historial: se conserva retirado para no perder la trazabilidad.`);
      }
      const eliminado = await d.repositorio.eliminarDefinitivo(def, id);
      if (!eliminado) throw errorConflicto('El permiso cambió o ya tiene ingresos. Actualice la lista.');
      await d.evidencia?.eliminar(eliminado.rutas);
      await d.auditoria.operacion(actor, 'LISTA_ELIMINADO', def.entidad, id,
        `${registro.placa || registro.propietario || 'Permiso sin placa'} · eliminado definitivamente (${registro.activo ? 'vencido' : 'retirado'}, registrado por ${registro.registrado_por_email ?? 'usuario desconocido'})`);
      difundir(def);
    },

    /**
     * Importa permisos de la lista blanca desde una hoja (formato de la garita: id, nombres, cedula,
     * institucion, cargo, placa, marca, modelo, tipo, color). Cada fila se valida como el formulario;
     * con `simular` solo informa qué pasaría (vista previa) y no guarda nada. Una placa ya activa se
     * omite (no se sobrescribe), una retirada se reactiva y los errores no detienen a las demás filas.
     * Cada alta queda en la auditoría y la importación completa también, con el nombre del archivo.
     */
    async importar(def: DefinicionLista, contenido: Buffer, nombreArchivo: unknown, actor: Actor, simular: boolean) {
      if (def.tipo !== 'autorizados') throw errorValidacion('Solo se importan permisos de la lista blanca.');
      if (!d.leerHoja) throw errorValidacion('La importación de hojas de cálculo no está disponible.');
      if (!contenido.length) throw errorValidacion('Seleccione un archivo .xlsx o .csv.');
      const archivo = String(nombreArchivo ?? 'archivo').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 100) || 'archivo';
      const filas = leerFilasImportacion(await d.leerHoja(contenido));
      if (!filas.ok) throw errorValidacion(filas.error);

      const vistas = new Map<string, number>();
      const resultados: ResultadoFilaImportacion[] = [];
      for (const f of filas.valor) {
        const base = { fila: f.fila, id: f.id, propietario: f.entrada.propietario ?? null, placa: f.entrada.placa ?? null };
        const fallo = (mensaje: string) => resultados.push({ ...base, accion: 'error', mensaje });
        const r = leerRegistroLista(def, f.entrada);
        if (!r.ok) { fallo(r.error); continue; }
        const placa = r.valor.placa || null;
        const cedula = r.valor.datos.cedula;
        Object.assign(base, { placa, propietario: r.valor.datos.propietario });
        const repetida = (placa && vistas.get(`placa:${placa}`)) || (cedula && vistas.get(`cedula:${cedula}`));
        if (repetida) { fallo(`Repite la placa o la cédula de la fila ${repetida}.`); continue; }
        if (placa) vistas.set(`placa:${placa}`, f.fila);
        if (cedula) vistas.set(`cedula:${cedula}`, f.fila);

        const previo = placa ? await d.repositorio.buscarPorPlaca(def, placa) : null;
        if (previo?.activo) {
          resultados.push({ ...base, accion: 'omitir', mensaje: 'La placa ya está en la lista blanca: se conserva el permiso vigente.' });
          continue;
        }
        if (previo && actor.rol === 'GestorPermisos' && Number(previo.registrado_por) !== actor.id) {
          fallo('La placa tiene un permiso retirado de otro usuario: solicite su reactivación al administrador.');
          continue;
        }
        if (cedula && d.repositorio.existeOtraConCedula && await d.repositorio.existeOtraConCedula(def, cedula, previo?.id)) {
          fallo(`La cédula ${cedula} ya tiene un permiso activo en la lista blanca.`);
          continue;
        }
        if (simular) {
          resultados.push({ ...base, accion: previo ? 'reactivar' : 'crear', mensaje: previo ? 'Se reactivará el permiso retirado.' : 'Se creará el permiso.' });
          continue;
        }
        try {
          const { id, accion } = await guardar(def, r.valor, actor);
          await d.auditoria.operacion(actor, accion === 'reactivado' ? 'LISTA_REACTIVADO' : 'LISTA_ALTA', def.entidad, id,
            `${describirRegistro(r.valor, d.describirHorario)} · importado de ${archivo}`);
          resultados.push({ ...base, accion: accion === 'reactivado' ? 'reactivar' : 'crear', mensaje: accion === 'reactivado' ? 'Permiso reactivado.' : 'Permiso creado.' });
        } catch (e) {
          fallo((e as Error).message);
        }
      }

      const cuenta = (a: ResultadoFilaImportacion['accion']) => resultados.filter(x => x.accion === a).length;
      const resumen = { total: resultados.length, crear: cuenta('crear'), reactivar: cuenta('reactivar'), omitir: cuenta('omitir'), error: cuenta('error') };
      if (!simular && resumen.crear + resumen.reactivar > 0) {
        await d.auditoria.operacion(actor, 'LISTA_IMPORTACION', def.entidad, null,
          `${archivo} · ${resumen.crear} creados, ${resumen.reactivar} reactivados, ${resumen.omitir} omitidos, ${resumen.error} con error`);
        difundir(def);
      }
      return { simulacion: simular, archivo, resumen, filas: resultados };
    },

    /**
     * Registro de permisos del administrador (padron:supervisar): todos los permisos de la lista
     * blanca, de todos los usuarios o de uno, incluidos los retirados, con el resumen de lo que
     * otorgó cada gestor. Los usuarios del resumen se cuentan sobre todos sus permisos, sin filtros.
     */
    async registroPermisos(consulta: Record<string, unknown>) {
      const usuario = validarEntero(consulta.usuario, { etiqueta: 'Usuario', min: 1, max: 2_147_483_647 });
      if (!usuario.ok) throw errorValidacion(usuario.error);
      const estado = leerEstado(consulta.estado, 'todos');
      const [items, todos, usuarios] = await Promise.all([
        d.repositorio.registroPermisos({ usuarioId: usuario.valor, estado }),
        d.repositorio.registroPermisos({ usuarioId: null, estado: 'todos' }),
        d.repositorio.usuariosPadron(),
      ]);
      return { items, usuarios: resumirPorUsuario(usuarios, todos) };
    },

    /**
     * Permisos que otorgó el propio usuario («Mis permisos»), activos por omisión; con
     * ?estado=retirados o todos, también los desactivados, para volver a activarlos o renovarlos.
     */
    async misPermisos(consulta: Record<string, unknown>, actor: Actor) {
      return d.repositorio.registroPermisos({ usuarioId: actor.id, estado: leerEstado(consulta.estado, 'activos') });
    },

    /**
     * Vuelve a activar un permiso desactivado con sus mismos datos. El administrador
     * (padron:supervisar), cualquiera; quien gestiona el padrón, solo los que otorgó. El motivo es
     * opcional y queda en la auditoría.
     */
    async reactivar(def: DefinicionLista, id: number, motivo: unknown, actor: Actor) {
      const m = validarTexto(motivo, { etiqueta: 'Motivo de la reactivación', tipo: 'libre', min: 5, max: 300 });
      if (!m.ok) throw errorValidacion(m.error);
      const registro = await d.repositorio.obtener(def, id);
      if (!registro) throw errorNoEncontrado('Registro no encontrado.');
      if (!tienePermiso(actor.rol as Rol, 'padron:supervisar') && Number(registro.registrado_por) !== actor.id) {
        throw errorProhibido('Este permiso lo otorgó otro usuario: solo el administrador puede activarlo.');
      }
      if (registro.activo) throw errorConflicto('El permiso ya está activo.');
      // Vencido: volver a activarlo no lo habilitaría y la tarea lo retiraría de nuevo; se renueva con otra vigencia
      if (registro.vigente === false && registro.fecha_vencimiento) {
        throw errorConflicto(`El permiso venció el ${new Date(registro.fecha_vencimiento).toISOString().slice(0, 10)}: renuévelo con una vigencia nueva en lugar de reactivarlo.`);
      }
      if (def.tipo === 'autorizados' && registro.cedula && d.repositorio.existeOtraConCedula
          && await d.repositorio.existeOtraConCedula(def, registro.cedula, id)) {
        throw errorConflicto(`La cédula ${registro.cedula} ya tiene otro permiso activo en la lista blanca.`);
      }
      if (!await d.repositorio.restaurar(def, id)) throw errorConflicto('El permiso cambió. Actualice la lista.');
      const nombre = registro.placa || registro.propietario || 'Permiso sin placa';
      await d.auditoria.operacion(actor, 'LISTA_REACTIVADO', def.entidad, id, m.valor ? `${nombre} · ${m.valor}` : nombre);
      difundir(def);
      return (await d.repositorio.obtener(def, id))!;
    },

    async completarPlaca(def: DefinicionLista, id: number, entrada: unknown, actor: Actor) {
      if (def.tipo !== 'autorizados') throw errorValidacion('Solo se completan permisos de la lista blanca.');
      const placa = validarPlaca(entrada);
      if (!placa.ok) throw errorValidacion(placa.error);
      const actual = await d.repositorio.obtenerActivo(def, id);
      if (!actual) throw errorNoEncontrado('Permiso no encontrado.');
      if (actual.placa) throw errorConflicto('El permiso ya tiene placa. Solicite su edición al gestor.');
      if (await d.repositorio.existeOtraConPlaca(def, placa.valor.placa, id)) throw errorConflicto('La placa ya pertenece a otro permiso.');
      if (!d.repositorio.asignarPlaca || !await d.repositorio.asignarPlaca(id, placa.valor.placa)) throw errorConflicto('El permiso cambió. Actualice la lista.');
      await d.auditoria.operacion(actor, 'LISTA_COMPLETAR_PLACA', def.entidad, id, `${actual.propietario} · ${placa.valor.placa}`);
      const item = (await d.repositorio.obtener(def, id))!;
      await d.avisos.registroAgregado(def, item, actor);
      difundir(def);
      return item;
    },
  };
}

export type CasosListas = ReturnType<typeof casosListas>;
