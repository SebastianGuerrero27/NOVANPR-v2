import { casosListas, type RepositorioListas } from '../../aplicacion/listas';
import { ErrorAplicacion, type Actor } from '../../aplicacion/comun';
import { LISTA_BLANCA, LISTA_NEGRA } from '../../dominio/listas';

/** Casos de uso de las listas con dobles de prueba: sin base de datos, sin red. */

const ACTOR: Actor = { id: 9, email: 'gestor@ecu911.gob.ec', nombre: 'Gestor', rol: 'GestorPermisos', ip: '10.0.0.1' };

function preparar(existente: { id: number; activo: boolean; registrado_por?: number } | null = null) {
  const repositorio: jest.Mocked<RepositorioListas> = {
    asignarPlaca: jest.fn().mockResolvedValue(true),
    listar: jest.fn().mockResolvedValue([]),
    obtener: jest.fn().mockImplementation(async (_d, id) => ({ id, placa: 'PBA1234', propietario: 'Juan Pérez', registrado_por: ACTOR.id })),
    obtenerActivo: jest.fn().mockResolvedValue({ id: 5, placa: 'PBA1234', propietario: 'Juan Pérez', categoria: 'FUNCIONARIO', registrado_por: ACTOR.id }),
    buscarPorPlaca: jest.fn().mockResolvedValue(existente ? { registrado_por: ACTOR.id, ...existente } : null),
    existeOtraConPlaca: jest.fn().mockResolvedValue(false),
    crear: jest.fn().mockResolvedValue(77),
    reactivar: jest.fn().mockResolvedValue(undefined),
    actualizar: jest.fn().mockResolvedValue(undefined),
    retirar: jest.fn().mockResolvedValue('PBA1234'),
    registroPermisos: jest.fn().mockResolvedValue([]),
    usuariosPadron: jest.fn().mockResolvedValue([]),
    restaurar: jest.fn().mockResolvedValue(true),
    eliminarDefinitivo: jest.fn().mockResolvedValue({ rutas: ['/app/evidencia-listas/lista_autorizado_5_x_vehiculo.jpg', null] }),
    retirarVencidos: jest.fn().mockResolvedValue([]),
  };
  const auditoria = { operacion: jest.fn().mockResolvedValue(undefined) };
  const eventos = { emitir: jest.fn() };
  const avisos = { registroAgregado: jest.fn() };
  const casos = casosListas({ repositorio, auditoria, eventos, avisos, describirHorario: () => 'Todos los días' });
  return { casos, repositorio, auditoria, eventos, avisos };
}

const fallo = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as ErrorAplicacion; }
  throw new Error('se esperaba un error');
};

describe('Casos de uso · listas', () => {
  it('el alta espera a que el aviso quede disponible para la garita antes de responder', async () => {
    const { casos, avisos } = preparar();
    let completar!: () => void;
    avisos.registroAgregado.mockImplementation(() => new Promise<void>(resolve => { completar = resolve; }));
    let respondio = false;
    const guardado = casos.registrar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana Pérez' }, ACTOR)
      .then(() => { respondio = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(avisos.registroAgregado).toHaveBeenCalledWith(LISTA_BLANCA, expect.objectContaining({ id: 77 }), ACTOR);
    expect(respondio).toBe(false);
    completar();
    await guardado;
    expect(respondio).toBe(true);
  });

  it('la garita consulta todos los permisos aunque los haya registrado otro usuario', async () => {
    const { casos, repositorio } = preparar();
    await casos.listar(LISTA_BLANCA, { ...ACTOR, id: 3, rol: 'Guardia' });
    expect(repositorio.listar).toHaveBeenCalledWith(LISTA_BLANCA, undefined);
  });

  it('guarda cédula con ceros iniciales, institución y cargo con los datos del vehículo', async () => {
    const { casos, repositorio } = preparar();
    await casos.registrar(LISTA_BLANCA, {
      propietario: 'Ana Pérez', cedula: '0703799247', institucion: 'ECU 911', cargo: 'Analista de soporte zonal',
      placa: 'PBA1234', marca: 'Toyota', modelo: 'Fortuner', tipo_vehiculo: 'SUV', color: 'Blanco',
    }, ACTOR);
    expect(repositorio.crear).toHaveBeenCalledWith(LISTA_BLANCA, expect.objectContaining({ datos: expect.objectContaining({
      cedula: '0703799247', institucion: 'ECU 911', cargo: 'Analista de soporte zonal', marca: 'Toyota', modelo: 'Fortuner', tipo_vehiculo: 'SUV', color: 'Blanco',
    }) }), ACTOR.id, undefined);
  });

  it.each(['123', 'ABCDEFGHIJ', '07037992470'])('rechaza una cédula incompleta o no numérica: %s', async cedula => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.registrar(LISTA_BLANCA, { propietario: 'Ana Pérez', cedula }, ACTOR))).tipo).toBe('validacion');
    expect(repositorio.crear).not.toHaveBeenCalled();
  });
  it('el gestor consulta sus permisos usando su identidad de sesión', async () => {
    const { casos, repositorio } = preparar();
    await casos.listar(LISTA_BLANCA, ACTOR);
    expect(repositorio.listar).toHaveBeenLastCalledWith(LISTA_BLANCA, ACTOR.id);
    await casos.listar(LISTA_BLANCA, { ...ACTOR, id: 18 });
    expect(repositorio.listar).toHaveBeenLastCalledWith(LISTA_BLANCA, 18);
  });

  it('otro gestor no puede leer por id, editar ni retirar un permiso ajeno', async () => {
    const { casos, repositorio } = preparar();
    const otro = { ...ACTOR, id: 18 };
    expect((await fallo(casos.obtener(LISTA_BLANCA, 5, otro))).tipo).toBe('prohibido');
    expect((await fallo(casos.editar(LISTA_BLANCA, 5, { placa: 'PBA1234', propietario: 'Ana Pérez' }, otro))).tipo).toBe('prohibido');
    expect((await fallo(casos.retirar(LISTA_BLANCA, 5, 'Retiro ajeno', otro))).tipo).toBe('prohibido');
    expect(repositorio.actualizar).not.toHaveBeenCalled();
    expect(repositorio.retirar).not.toHaveBeenCalled();
  });

  it.each([true, false])('no permite apropiarse de una placa de otro usuario (activa: %s)', async activo => {
    const { casos, repositorio } = preparar({ id: 5, activo, registrado_por: 18 });
    const r = casos.validar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana Pérez' });
    expect((await fallo(casos.guardar(LISTA_BLANCA, r, ACTOR, { actualizarSiExiste: true }))).tipo).toBe('prohibido');
    expect(repositorio.actualizar).not.toHaveBeenCalled();
    expect(repositorio.reactivar).not.toHaveBeenCalled();
    expect(repositorio.crear).not.toHaveBeenCalled();
  });
  it('permite registrar solo el nombre, sin buscar ni reactivar otra persona sin placa', async () => {
    const { casos, repositorio, auditoria } = preparar({ id: 5, activo: true });
    await casos.registrar(LISTA_BLANCA, { propietario: 'Ana Pérez' }, ACTOR);
    expect(repositorio.buscarPorPlaca).not.toHaveBeenCalled();
    expect(repositorio.crear).toHaveBeenCalledWith(LISTA_BLANCA, expect.objectContaining({ placa: '', datos: expect.objectContaining({ propietario: 'Ana Pérez' }) }), ACTOR.id, undefined);
    expect(auditoria.operacion).toHaveBeenCalledWith(ACTOR, 'LISTA_ALTA', 'autorizado', 77, expect.stringContaining('pendiente de placa'));
  });

  it('permite alertas sin placa y mantiene obligatorio el propietario de la lista blanca', async () => {
    const { casos, repositorio } = preparar();
    await casos.registrar(LISTA_NEGRA, { motivo: 'Alerta de prueba', nivel_alerta: 'ALTA' }, ACTOR);
    expect((await fallo(casos.registrar(LISTA_BLANCA, {}, ACTOR))).tipo).toBe('validacion');
    expect(repositorio.crear).toHaveBeenCalledWith(LISTA_NEGRA, expect.objectContaining({ placa: '' }), 9, undefined);
  });

  it('completa solo una placa pendiente, con validación y auditoría, sin cambiar vigencia ni horario', async () => {
    const { casos, repositorio, auditoria } = preparar();
    repositorio.obtenerActivo.mockResolvedValue({ id: 5, placa: null, propietario: 'Ana Pérez' });
    await casos.completarPlaca(LISTA_BLANCA, 5, 'pba-1234', ACTOR);
    expect(repositorio.asignarPlaca).toHaveBeenCalledWith(5, 'PBA1234');
    expect(repositorio.actualizar).not.toHaveBeenCalled();
    expect(auditoria.operacion).toHaveBeenCalledWith(ACTOR, 'LISTA_COMPLETAR_PLACA', 'autorizado', 5, 'Ana Pérez · PBA1234');
    repositorio.obtenerActivo.mockResolvedValue({ id: 5, placa: 'PBA1234' });
    expect((await fallo(casos.completarPlaca(LISTA_BLANCA, 5, 'ABC1234', ACTOR))).tipo).toBe('conflicto');
  });
  it('registrar: valida, crea, audita, difunde y avisa a la garita', async () => {
    const { casos, repositorio, auditoria, eventos, avisos } = preparar();
    const r = await casos.registrar(LISTA_BLANCA, { placa: 'pba-1234', propietario: 'Juan Pérez', color: 'Blanco' }, ACTOR);
    expect(r.accion).toBe('creado');
    expect(repositorio.crear).toHaveBeenCalledWith(LISTA_BLANCA, expect.objectContaining({ placa: 'PBA1234' }), 9, undefined);
    expect(auditoria.operacion).toHaveBeenCalledWith(ACTOR, 'LISTA_ALTA', 'autorizado', 77, expect.stringContaining('PBA1234'));
    expect(eventos.emitir).toHaveBeenCalledWith('listas:actualizadas', { lista: 'autorizado' });
    expect(avisos.registroAgregado).toHaveBeenCalledWith(LISTA_BLANCA, expect.objectContaining({ id: 77 }), ACTOR);
  });

  it('registrar: rechaza placas fuera del formato AAA-1234 / AAA-123 / AA-123A sin tocar la base', async () => {
    const { casos, repositorio } = preparar();
    const e = await fallo(casos.registrar(LISTA_BLANCA, { placa: 'ABC12', propietario: 'Juan Pérez' }, ACTOR));
    expect(e.tipo).toBe('validacion');
    expect(e.message).toMatch(/ABC-1234/);
    expect(repositorio.buscarPorPlaca).not.toHaveBeenCalled();
  });

  it('registrar: rechaza un propietario con números y un color con dígitos', async () => {
    const { casos } = preparar();
    expect((await fallo(casos.registrar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Juan 23' }, ACTOR))).tipo).toBe('validacion');
    expect((await fallo(casos.registrar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Juan', color: 'Rojo2' }, ACTOR))).tipo).toBe('validacion');
  });

  it('registrar: conflicto si la placa ya está activa; reactiva si se había retirado', async () => {
    expect((await fallo(preparar({ id: 5, activo: true }).casos.registrar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana' }, ACTOR))).tipo)
      .toBe('conflicto');
    const { casos, repositorio, auditoria } = preparar({ id: 5, activo: false });
    expect((await casos.registrar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana' }, ACTOR)).accion).toBe('reactivado');
    expect(repositorio.reactivar).toHaveBeenCalled();
    expect(auditoria.operacion).toHaveBeenCalledWith(ACTOR, 'LISTA_REACTIVADO', 'autorizado', 5, expect.any(String));
  });

  it('guardar con actualizarSiExiste (aprobación de solicitud): amplía el permiso activo', async () => {
    const { casos, repositorio } = preparar({ id: 5, activo: true });
    const r = casos.validar(LISTA_BLANCA, { placa: 'PBA1234', propietario: 'Ana' });
    expect(await casos.guardar(LISTA_BLANCA, r, ACTOR, { actualizarSiExiste: true })).toEqual({ id: 5, accion: 'actualizado' });
    expect(repositorio.actualizar).toHaveBeenCalledWith(LISTA_BLANCA, 5, r);
  });

  it('editar: 404 si no existe; 409 si otra fila tiene la placa', async () => {
    const a = preparar();
    a.repositorio.obtenerActivo.mockResolvedValue(null);
    expect((await fallo(a.casos.editar(LISTA_BLANCA, 5, { placa: 'PBA1234', propietario: 'Ana' }, ACTOR))).tipo).toBe('no_encontrado');
    const b = preparar();
    b.repositorio.existeOtraConPlaca.mockResolvedValue(true);
    expect((await fallo(b.casos.editar(LISTA_BLANCA, 5, { placa: 'PBA1234', propietario: 'Ana' }, ACTOR))).tipo).toBe('conflicto');
  });

  it('lista negra: no avisa a la garita como alta de permiso y exige motivo y nivel válidos', async () => {
    const { casos } = preparar();
    expect((await fallo(casos.registrar(LISTA_NEGRA, { placa: 'PBA1234', motivo: 'Robo', nivel_alerta: 'ALTA' }, ACTOR))).tipo).toBe('validacion');
    expect((await fallo(casos.registrar(LISTA_NEGRA, { placa: 'PBA1234', motivo: 'Vehículo robado', nivel_alerta: 'URGENTE' }, ACTOR))).tipo).toBe('validacion');
  });

  it('retirar: un permiso y una placa de la lista negra se retiran sin motivo; un motivo escrito se valida y audita', async () => {
    const { casos, auditoria } = preparar();
    await casos.retirar(LISTA_BLANCA, 5, undefined, ACTOR);
    expect(auditoria.operacion).toHaveBeenLastCalledWith(ACTOR, 'LISTA_RETIRO', 'autorizado', 5, 'PBA1234');
    expect((await fallo(casos.retirar(LISTA_BLANCA, 5, 'no', ACTOR))).tipo).toBe('validacion');
    await casos.retirar(LISTA_BLANCA, 5, 'Finalizó el contrato', ACTOR);
    expect(auditoria.operacion).toHaveBeenLastCalledWith(ACTOR, 'LISTA_RETIRO', 'autorizado', 5, 'PBA1234 · Finalizó el contrato');
    await casos.retirar(LISTA_NEGRA, 5, undefined, ACTOR);
    expect(auditoria.operacion).toHaveBeenLastCalledWith(ACTOR, 'LISTA_RETIRO', 'lista_negra', 5, 'PBA1234');
    expect((await fallo(casos.retirar(LISTA_NEGRA, 5, 'no', ACTOR))).tipo).toBe('validacion');
  });
});

describe('Casos de uso · eliminación definitiva de un permiso', () => {
  const ADMIN: Actor = { id: 1, email: 'admin@ecu911.gob.ec', nombre: 'Admin', rol: 'Admin', ip: '10.0.0.2' };
  const conEvidencia = (registro: Record<string, unknown>) => {
    const p = preparar();
    p.repositorio.obtener.mockResolvedValue({ id: 5, placa: 'PBA1234', propietario: 'Ana', registrado_por_email: 'gestor@ecu911.gob.ec', ...registro });
    const evidencia = { eliminar: jest.fn().mockResolvedValue(1) };
    const casos = casosListas({ repositorio: p.repositorio, auditoria: p.auditoria, eventos: p.eventos, avisos: p.avisos,
      describirHorario: () => 'Todos los días', evidencia });
    return { ...p, casos, evidencia };
  };

  it('elimina un permiso retirado o vencido sin ingresos, borra su evidencia y lo audita', async () => {
    const { casos, repositorio, auditoria, evidencia, eventos } = conEvidencia({ activo: false, vigente: true, ingresos: 0 });
    await casos.eliminarDefinitivo(LISTA_BLANCA, 5, ADMIN);
    expect(repositorio.eliminarDefinitivo).toHaveBeenCalledWith(LISTA_BLANCA, 5);
    expect(evidencia.eliminar).toHaveBeenCalledWith(['/app/evidencia-listas/lista_autorizado_5_x_vehiculo.jpg', null]);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'LISTA_ELIMINADO', 'autorizado', 5, 'PBA1234 · eliminado definitivamente (retirado, registrado por gestor@ecu911.gob.ec)');
    expect(eventos.emitir).toHaveBeenCalledWith('listas:actualizadas', { lista: 'autorizado' });

    const vencido = conEvidencia({ activo: true, vigente: false, ingresos: 0 });
    await vencido.casos.eliminarDefinitivo(LISTA_BLANCA, 5, ADMIN);
    expect(vencido.repositorio.eliminarDefinitivo).toHaveBeenCalled();
  });

  it('no elimina un permiso vigente ni uno con ingresos en el historial (409)', async () => {
    const vigente = conEvidencia({ activo: true, vigente: true, ingresos: 0 });
    expect((await fallo(vigente.casos.eliminarDefinitivo(LISTA_BLANCA, 5, ADMIN))).tipo).toBe('conflicto');
    const conIngresos = conEvidencia({ activo: false, vigente: true, ingresos: 3 });
    const e = await fallo(conIngresos.casos.eliminarDefinitivo(LISTA_BLANCA, 5, ADMIN));
    expect([e.tipo, e.message]).toEqual(['conflicto', 'El permiso tiene 3 ingresos en el historial: se conserva retirado para no perder la trazabilidad.']);
    expect(conIngresos.repositorio.eliminarDefinitivo).not.toHaveBeenCalled();
    expect(conIngresos.evidencia.eliminar).not.toHaveBeenCalled();
  });
});

describe('Casos de uso · importación de permisos (datos ficticios)', () => {
  const CABECERA = ['id', 'nombres', 'cedula', 'institucion', 'cargo', 'placa', 'marca', 'modelo', 'tipo', 'color'];
  const hoja = (...filas: string[][]) => jest.fn().mockResolvedValue([CABECERA, ...filas]);
  const conHoja = (leerHoja: jest.Mock) => {
    const p = preparar();
    p.repositorio.existeOtraConCedula = jest.fn().mockResolvedValue(false);
    const casos = casosListas({ repositorio: p.repositorio, auditoria: p.auditoria, eventos: p.eventos, avisos: p.avisos,
      describirHorario: () => 'Todos los días', leerHoja });
    return { ...p, casos };
  };
  const filas = [
    ['1', 'ANA TORRES PAZ', '0912345678', 'ECU 911', 'ANALISTA', 'PDX-525', 'CHEVROLET', 'FORZA', 'COUPE', 'GRIS'],
    ['2', 'LUIS MORA', '0923456789', 'ECU 911', 'CHOFER', 'PBX-1234', 'KIA', 'RIO', 'SEDAN', 'ROJO'],
    ['3', 'R0SA', '', '', '', '', '', '', '', ''],
    ['4', 'PEDRO PAZ', '0912345678', '', '', 'PCX-1010', '', '', '', ''],
  ];

  it('vista previa: valida cada fila, no guarda nada y explica lo que pasaría', async () => {
    const { casos, repositorio, auditoria } = conHoja(hoja(...filas));
    repositorio.buscarPorPlaca.mockImplementation(async (_d, placa) => (placa === 'PBX1234' ? { id: 8, activo: true, registrado_por: ACTOR.id } : null));
    const r = await casos.importar(LISTA_BLANCA, Buffer.from('x'), 'permisos.xlsx', ACTOR, true);
    expect(r.resumen).toEqual({ total: 4, crear: 1, reactivar: 0, omitir: 1, error: 2 });
    expect(r.filas.map(f => [f.fila, f.id, f.accion])).toEqual([[2, '1', 'crear'], [3, '2', 'omitir'], [4, '3', 'error'], [5, '4', 'error']]);
    expect(r.filas[0]).toMatchObject({ placa: 'PDX525', propietario: 'ANA TORRES PAZ' });
    expect(r.filas[3].mensaje).toBe('Repite la placa o la cédula de la fila 2.');
    expect(repositorio.crear).not.toHaveBeenCalled();
    expect(auditoria.operacion).not.toHaveBeenCalled();
  });

  it('importa sin sobrescribir lo vigente, reactiva lo retirado y audita cada alta y el archivo', async () => {
    const { casos, repositorio, auditoria, eventos } = conHoja(hoja(filas[0], filas[1]));
    repositorio.buscarPorPlaca.mockImplementation(async (_d, placa) => (placa === 'PBX1234' ? { id: 8, activo: false, registrado_por: ACTOR.id } : null));
    const r = await casos.importar(LISTA_BLANCA, Buffer.from('x'), 'permisos.xlsx', ACTOR, false);
    expect(r.resumen).toMatchObject({ crear: 1, reactivar: 1, error: 0 });
    expect(repositorio.crear).toHaveBeenCalledWith(LISTA_BLANCA, expect.objectContaining({ placa: 'PDX525' }), ACTOR.id, undefined);
    expect(repositorio.reactivar).toHaveBeenCalledWith(LISTA_BLANCA, 8, expect.objectContaining({ placa: 'PBX1234' }), ACTOR.id, undefined);
    expect(auditoria.operacion).toHaveBeenCalledWith(ACTOR, 'LISTA_ALTA', 'autorizado', 77, expect.stringContaining('importado de permisos.xlsx'));
    expect(auditoria.operacion).toHaveBeenCalledWith(ACTOR, 'LISTA_IMPORTACION', 'autorizado', null, 'permisos.xlsx · 1 creados, 1 reactivados, 0 omitidos, 0 con error');
    expect(eventos.emitir).toHaveBeenCalledTimes(1);
  });

  it('un gestor no reactiva el permiso retirado de otro usuario; archivo vacío o ilegible: 400', async () => {
    const { casos, repositorio } = conHoja(hoja(filas[0]));
    repositorio.buscarPorPlaca.mockResolvedValue({ id: 8, activo: false, registrado_por: 99 });
    const r = await casos.importar(LISTA_BLANCA, Buffer.from('x'), 'p.xlsx', ACTOR, false);
    expect(r.filas[0]).toMatchObject({ accion: 'error', mensaje: expect.stringMatching(/otro usuario/) });
    expect(repositorio.reactivar).not.toHaveBeenCalled();
    expect((await fallo(casos.importar(LISTA_BLANCA, Buffer.alloc(0), 'p.xlsx', ACTOR, true))).tipo).toBe('validacion');
    expect((await fallo(conHoja(jest.fn().mockResolvedValue([CABECERA])).casos.importar(LISTA_BLANCA, Buffer.from('x'), 'p', ACTOR, true))).tipo).toBe('validacion');
  });
});

describe('Casos de uso · registro de permisos del administrador', () => {
  const ADMIN: Actor = { id: 1, email: 'admin@ecu911.gob.ec', nombre: 'Admin', rol: 'Admin', ip: '10.0.0.2' };
  const permiso = (id: number, registradoPor: number, c: Record<string, unknown> = {}) => ({
    id, placa: `PBA${1000 + id}`, propietario: `Titular ${id}`, registrado_por: registradoPor, activo: true, vigente: true, por_vencer: false,
    fecha_registro: `2026-10-${10 + id}T15:00:00Z`, ...c,
  });

  it('entrega los permisos filtrados y cuenta, sin filtros, lo que otorgó cada usuario', async () => {
    const { casos, repositorio } = preparar();
    const todos = [
      permiso(1, 9), permiso(2, 9, { por_vencer: true }), permiso(3, 9, { vigente: false }), permiso(4, 9, { activo: false }),
      permiso(5, 9, { placa: null }), permiso(6, 1),
    ];
    repositorio.registroPermisos.mockImplementation(async f => (f.usuarioId === 9 ? todos.filter(p => p.registrado_por === 9) : todos));
    repositorio.usuariosPadron.mockResolvedValue([
      { id: 9, nombre: 'Gestor', email: 'gestor@ecu911.gob.ec', rol: 'GESTOR_PERMISOS', estado: 'activo' },
      { id: 4, nombre: 'Gestor nuevo', email: 'nuevo@ecu911.gob.ec', rol: 'GESTOR_PERMISOS', estado: 'activo' },
    ]);
    const r = await casos.registroPermisos({ usuario: '9', estado: 'todos' });
    expect(repositorio.registroPermisos).toHaveBeenCalledWith({ usuarioId: 9, estado: 'todos' });
    expect(r.items).toHaveLength(5);
    expect(r.usuarios[0]).toMatchObject({ id: 9, total: 5, activos: 4, vigentes: 2, por_vencer: 1, vencidos: 1, retirados: 1, sin_placa: 1,
      ultimo_registro: '2026-10-15T15:00:00.000Z' });
    // Un gestor sin permisos también aparece, para consultarlo
    expect(r.usuarios[1]).toMatchObject({ id: 4, total: 0, ultimo_registro: null });
  });

  it('valida el usuario y el estado antes de consultar', async () => {
    const { casos, repositorio } = preparar();
    expect((await fallo(casos.registroPermisos({ usuario: 'x' }))).tipo).toBe('validacion');
    expect((await fallo(casos.registroPermisos({ estado: 'borrados' }))).tipo).toBe('validacion');
    expect(repositorio.registroPermisos).not.toHaveBeenCalled();
  });

  it('reactivar: motivo opcional (si se escribe, se valida), solo un permiso retirado y sin otra cédula activa; queda en la auditoría', async () => {
    const { casos, repositorio, auditoria, eventos } = preparar();
    repositorio.obtener.mockResolvedValue({ id: 4, placa: 'PBA1004', propietario: 'Ana', cedula: '0703799247', activo: false });
    expect((await fallo(casos.reactivar(LISTA_BLANCA, 4, 'no', ADMIN))).tipo).toBe('validacion');
    await casos.reactivar(LISTA_BLANCA, 4, 'Renovó el contrato', ADMIN);
    expect(repositorio.restaurar).toHaveBeenCalledWith(LISTA_BLANCA, 4);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'LISTA_REACTIVADO', 'autorizado', 4, 'PBA1004 · Renovó el contrato');
    expect(eventos.emitir).toHaveBeenCalledWith('listas:actualizadas', { lista: 'autorizado' });
    await casos.reactivar(LISTA_BLANCA, 4, undefined, ADMIN);
    expect(auditoria.operacion).toHaveBeenLastCalledWith(ADMIN, 'LISTA_REACTIVADO', 'autorizado', 4, 'PBA1004');

    const activo = preparar();
    activo.repositorio.obtener.mockResolvedValue({ id: 4, placa: 'PBA1004', activo: true });
    expect((await fallo(activo.casos.reactivar(LISTA_BLANCA, 4, 'Renovó el contrato', ADMIN))).tipo).toBe('conflicto');

    const cedula = preparar();
    cedula.repositorio.obtener.mockResolvedValue({ id: 4, placa: 'PBA1004', cedula: '0703799247', activo: false });
    cedula.repositorio.existeOtraConCedula = jest.fn().mockResolvedValue(true);
    expect((await fallo(cedula.casos.reactivar(LISTA_BLANCA, 4, 'Renovó el contrato', ADMIN))).tipo).toBe('conflicto');
    expect(cedula.repositorio.restaurar).not.toHaveBeenCalled();
  });

  it('activar: el gestor (y el guardia) solo los permisos que otorgó; el administrador, cualquiera', async () => {
    const GUARDIA: Actor = { ...ACTOR, id: 3, rol: 'Guardia' };
    const ajeno = { id: 4, placa: 'PBA1004', propietario: 'Ana', activo: false, vigente: true, registrado_por: 2 };
    for (const actor of [ACTOR, GUARDIA]) {
      const { casos, repositorio } = preparar();
      repositorio.obtener.mockResolvedValue(ajeno);
      expect((await fallo(casos.reactivar(LISTA_BLANCA, 4, undefined, actor))).tipo).toBe('prohibido');
      expect(repositorio.restaurar).not.toHaveBeenCalled();
    }
    const propio = preparar();
    propio.repositorio.obtener.mockResolvedValue({ ...ajeno, registrado_por: ACTOR.id });
    await propio.casos.reactivar(LISTA_BLANCA, 4, undefined, ACTOR);
    expect(propio.repositorio.restaurar).toHaveBeenCalledWith(LISTA_BLANCA, 4);
    const admin = preparar();
    admin.repositorio.obtener.mockResolvedValue(ajeno);
    await admin.casos.reactivar(LISTA_BLANCA, 4, undefined, ADMIN);
    expect(admin.repositorio.restaurar).toHaveBeenCalledWith(LISTA_BLANCA, 4);
  });

  it('mis permisos: activos por omisión; desactivados o todos a pedido, siempre los del usuario', async () => {
    const { casos, repositorio } = preparar();
    await casos.misPermisos({}, ACTOR);
    expect(repositorio.registroPermisos).toHaveBeenLastCalledWith({ usuarioId: ACTOR.id, estado: 'activos' });
    await casos.misPermisos({ estado: 'retirados', usuario: '2' }, ACTOR);
    expect(repositorio.registroPermisos).toHaveBeenLastCalledWith({ usuarioId: ACTOR.id, estado: 'retirados' });
    expect((await fallo(casos.misPermisos({ estado: 'borrados' }, ACTOR))).tipo).toBe('validacion');
  });
});

describe('Casos de uso · permisos vencidos', () => {
  const ADMIN: Actor = { id: 1, email: 'admin@ecu911.gob.ec', nombre: 'Admin', rol: 'Admin', ip: '10.0.0.2' };

  it('la tarea retira de la lista blanca los permisos vencidos y audita cada uno a nombre del sistema', async () => {
    const { casos, repositorio, auditoria, eventos } = preparar();
    repositorio.retirarVencidos.mockResolvedValue([{ id: 4, nombre: 'PBA1004', vence: new Date('2026-10-27T00:00:00Z') }]);
    expect(await casos.retirarVencidos()).toBe(1);
    expect(repositorio.retirarVencidos).toHaveBeenCalledWith(LISTA_BLANCA);
    expect(auditoria.operacion).toHaveBeenCalledWith(expect.objectContaining({ id: null, rol: 'Sistema' }), 'LISTA_RETIRO', 'autorizado', 4,
      'PBA1004 · retiro automático: la vigencia terminó el 2026-10-27');
    expect(eventos.emitir).toHaveBeenCalledWith('listas:actualizadas', { lista: 'autorizado' });

    const nada = preparar();
    expect(await nada.casos.retirarVencidos()).toBe(0);
    expect(nada.eventos.emitir).not.toHaveBeenCalled();
  });

  it('un permiso vencido no se reactiva: se renueva con una vigencia nueva', async () => {
    const { casos, repositorio } = preparar();
    repositorio.obtener.mockResolvedValue({ id: 4, placa: 'PBA1004', activo: false, vigente: false, fecha_vencimiento: '2026-10-27T00:00:00Z' });
    const e = await fallo(casos.reactivar(LISTA_BLANCA, 4, undefined, ADMIN));
    expect([e.tipo, e.message]).toEqual(['conflicto', 'El permiso venció el 2026-10-27: renuévelo con una vigencia nueva en lugar de reactivarlo.']);
    expect(repositorio.restaurar).not.toHaveBeenCalled();
  });
});
