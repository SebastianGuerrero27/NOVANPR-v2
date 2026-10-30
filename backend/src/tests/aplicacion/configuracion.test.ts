import {
  casosConfiguracion, type CorreoGuardado, type ParametroDTO, type PuertoCorreoSaliente, type RepositorioConfiguracion, type RepositorioCorreoSaliente,
} from '../../aplicacion/configuracion';
import { ErrorAplicacion, type Actor } from '../../aplicacion/comun';
import { type ReglaParametro, validarParametro } from '../../dominio/configuracion';
import { DEFINICIONES } from '../../infraestructura/servicios/configuracion';

/** Configuración del sistema: reglas por tipo de parámetro y casos de uso con dobles (sin base de datos). */

const ADMIN: Actor = { id: 1, email: 'admin@ecu911.gob.ec', nombre: 'Administrador', rol: 'Admin', ip: '10.0.0.1' };

const SESION: ReglaParametro = { clave: 'sesion_horas', tipo: 'entero', etiqueta: 'Duración de la sesión (horas)', min: 1, max: 24 };
const REGISTRO: ReglaParametro = { clave: 'registro_publico_habilitado', tipo: 'booleano', etiqueta: 'Registro público de cuentas' };
const DOMINIOS: ReglaParametro = { clave: 'dominios_correo', tipo: 'lista', etiqueta: 'Dominios de correo permitidos' };
const CRITERIO: ReglaParametro = {
  clave: 'autorizacion_criterio', tipo: 'opcion', etiqueta: 'Criterio de autorización automática',
  opciones: [{ valor: 'validez_y_confianza' }, { valor: 'validez' }, { valor: 'confianza' }],
};
const UNIDAD: ReglaParametro = { clave: 'unidad_institucional', tipo: 'texto', etiqueta: 'Unidad institucional' };
const VERIFICACION: ReglaParametro = { clave: 'registro_verificacion_email_habilitada', tipo: 'booleano', etiqueta: 'Verificación de correo en el registro' };

const valor = (def: ReglaParametro, entrada: unknown) => {
  const r = validarParametro(def, entrada);
  return r.ok ? r.valor : `ERROR: ${r.error}`;
};

describe('Parámetros del sistema · validación por tipo declarado', () => {
  it('entero: solo dígitos dentro del rango declarado', () => {
    expect(valor(SESION, '8')).toBe('8');
    expect(valor(SESION, ' 08 ')).toBe('8');
    expect(valor(SESION, 12)).toBe('12');
    expect(valor(SESION, '0')).toBe('ERROR: Duración de la sesión (horas): mínimo 1.');
    expect(valor(SESION, '25')).toBe('ERROR: Duración de la sesión (horas): máximo 24.');
    for (const invalido of ['1.5', '1e1', '+5', 'ocho', '', null, [5], { n: 5 }]) {
      expect(validarParametro(SESION, invalido).ok).toBe(false);
    }
  });

  it('booleano: true o false', () => {
    expect(valor(REGISTRO, 'true')).toBe('true');
    expect(valor(REGISTRO, false)).toBe('false');
    for (const invalido of ['si', '1', 'verdadero', '', undefined]) expect(validarParametro(REGISTRO, invalido).ok).toBe(false);
  });

  it('dominios de correo: nombres de host válidos, en minúsculas, sin @ ni repetidos', () => {
    expect(valor(DOMINIOS, ' @ECU911.gob.ec, ecu911.gob.ec ,gob.ec')).toBe('ecu911.gob.ec,gob.ec');
    expect(valor(DOMINIOS, ['ecu911.gob.ec', 'xn--maana-pta.ec'])).toBe('ecu911.gob.ec,xn--maana-pta.ec');
    expect(valor(DOMINIOS, ' , ')).toBe('');
    expect(valor(DOMINIOS, '')).toBe('');
    for (const invalido of ['ecu911', '192.168.1.10', '-ecu911.gob.ec', 'ecu_911.gob.ec', 'ecu911..gob.ec', 'ecu911.gob.e1', 'ecu<911>.ec']) {
      expect(valor(DOMINIOS, invalido)).toMatch(/^ERROR: Dominios de correo permitidos: dominio inválido/);
    }
    const muchos = Array.from({ length: 40 }, (_, i) => `dependencia${i}.ecu911.gob.ec`).join(',');
    expect(valor(DOMINIOS, muchos)).toBe('ERROR: Dominios de correo permitidos: máximo 500 caracteres.');
  });

  it('opción: uno de los valores declarados', () => {
    expect(valor(CRITERIO, 'validez')).toBe('validez');
    expect(validarParametro(CRITERIO, 'cualquiera').ok).toBe(false);
  });

  it('texto: libre, obligatorio, hasta 150 caracteres y sin < >', () => {
    expect(valor(UNIDAD, '  Coordinación Zonal 3  ·  Ambato ')).toBe('Coordinación Zonal 3 · Ambato');
    expect(valor(UNIDAD, '<b>ECU 911</b>')).toMatch(/^ERROR: Unidad institucional: sin los caracteres < >/);
    expect(validarParametro(UNIDAD, 'x'.repeat(151)).ok).toBe(false);
    expect(validarParametro(UNIDAD, '   ').ok).toBe(false);
  });

  it('cada parámetro del sistema acepta su propio valor por omisión', () => {
    for (const d of DEFINICIONES) expect({ clave: d.clave, ok: validarParametro(d, d.omision).ok }).toEqual({ clave: d.clave, ok: true });
  });
});

const GUARDADO: CorreoGuardado = {
  servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', remitenteNombre: 'Sistema ANPR · ECU 911',
  remitenteCorreo: null, habilitado: true, claveLegible: true, actualizadoPor: 'admin@ecu911.gob.ec', fechaActualizacion: '2026-10-29T10:00:00Z',
  ultimaPrueba: null, ultimaPruebaOk: null, ultimaPruebaDetalle: null,
};

function preparar(opciones: { verificacion?: string; origen?: 'sistema' | 'entorno' | null; guardado?: CorreoGuardado | null; servidor?: boolean } = {}) {
  const parametros: ParametroDTO[] = [
    { ...SESION, valor: '8', origen: 'omision' },
    { ...REGISTRO, valor: 'true', origen: 'entorno' },
    { ...DOMINIOS, valor: 'ecu911.gob.ec', origen: 'entorno' },
    { ...VERIFICACION, valor: opciones.verificacion ?? 'false', origen: 'omision' },
  ];
  const repositorio: jest.Mocked<RepositorioConfiguracion> = {
    definiciones: jest.fn().mockReturnValue([SESION, REGISTRO, DOMINIOS, VERIFICACION]),
    listar: jest.fn().mockReturnValue(parametros),
    guardar: jest.fn().mockResolvedValue(undefined),
    recargar: jest.fn().mockResolvedValue(undefined),
  };
  const entorno = { describir: jest.fn().mockResolvedValue({ zona_horaria: 'America/Guayaquil', entorno: 'test' }) };
  const auditoria = { operacion: jest.fn().mockResolvedValue(undefined) };
  const correos: jest.Mocked<RepositorioCorreoSaliente> = {
    obtener: jest.fn().mockResolvedValue(opciones.guardado === undefined ? null : opciones.guardado),
    guardar: jest.fn().mockResolvedValue(undefined),
    eliminar: jest.fn().mockResolvedValue(undefined),
    registrarPrueba: jest.fn().mockResolvedValue(undefined),
  };
  const servicio: jest.Mocked<PuertoCorreoSaliente> = {
    origen: jest.fn().mockReturnValue(opciones.origen === undefined ? null : opciones.origen),
    hayCuentaDelServidor: jest.fn().mockReturnValue(opciones.servidor ?? false),
    recargar: jest.fn().mockResolvedValue(undefined),
    probar: jest.fn().mockResolvedValue({ ok: true }),
    cifrar: jest.fn((clave: string) => `enc.v1.prueba.${clave.length}`),
  };
  return {
    casos: casosConfiguracion({ repositorio, entorno, auditoria, correo: { repositorio: correos, servicio } }),
    repositorio, auditoria, parametros, correos, servicio,
  };
}

const fallo = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as ErrorAplicacion; }
  throw new Error('se esperaba un error');
};

describe('Casos de uso · configuración', () => {
  it('consultar: parámetros vigentes y datos del entorno', async () => {
    const { casos, parametros } = preparar();
    expect(await casos.consultar()).toEqual({ parametros, entorno: { zona_horaria: 'America/Guayaquil', entorno: 'test' } });
  });

  it.each([undefined, null, {}, [], 'sesion_horas=10'])('guardar: sin valores (%j) → 400 "No hay cambios para guardar."', async (valores) => {
    const { casos, repositorio } = preparar();
    const e = await fallo(casos.guardar(valores, ADMIN));
    expect(e.tipo).toBe('validacion');
    expect(e.message).toBe('No hay cambios para guardar.');
    expect(repositorio.guardar).not.toHaveBeenCalled();
  });

  it('guardar: una clave desconocida o un valor inválido rechazan todo el cambio sin escribir nada', async () => {
    const { casos, repositorio, auditoria } = preparar();
    const desconocida = await fallo(casos.guardar({ sesion_horas: '10', clave_rara: 'x' }, ADMIN));
    expect(desconocida.tipo).toBe('validacion');
    expect(desconocida.message).toBe('Parámetro desconocido: clave_rara');
    expect((await fallo(casos.guardar({ sesion_horas: '10', registro_publico_habilitado: 'quizás' }, ADMIN))).tipo).toBe('validacion');
    expect((await fallo(casos.guardar({ dominios_correo: 'ecu911.gob.ec,localhost' }, ADMIN))).tipo).toBe('validacion');
    expect(repositorio.guardar).not.toHaveBeenCalled();
    expect(auditoria.operacion).not.toHaveBeenCalled();
    expect(repositorio.recargar).not.toHaveBeenCalled();
  });

  it('guardar: escribe y audita solo lo que cambió (normalizado) y recarga la configuración', async () => {
    const { casos, repositorio, auditoria, parametros } = preparar();
    const r = await casos.guardar({ sesion_horas: '010', registro_publico_habilitado: 'true', dominios_correo: '@ECU911.gob.ec' }, ADMIN);
    expect(repositorio.guardar).toHaveBeenCalledTimes(1);
    expect(repositorio.guardar).toHaveBeenCalledWith('sesion_horas', '10', ADMIN.id);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'CONFIGURACION', 'configuracion', null, 'sesion_horas: 8 → 10');
    expect(repositorio.recargar).toHaveBeenCalled();
    expect(r).toEqual({ cambiados: 1, parametros });
  });

  it('guardar lista vacía de dominios permite usar cualquier correo válido', async () => {
    const { casos, repositorio, auditoria } = preparar();
    const r = await casos.guardar({ dominios_correo: '' }, ADMIN);
    expect(repositorio.guardar).toHaveBeenCalledWith('dominios_correo', '', ADMIN.id);
    expect(auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'CONFIGURACION', 'configuracion', null, 'dominios_correo: ecu911.gob.ec → ');
    expect(repositorio.recargar).toHaveBeenCalled();
    expect(r.cambiados).toBe(1);
  });

  it('guardar sin cambios reales: no escribe ni audita, pero recarga y responde los parámetros', async () => {
    const { casos, repositorio, auditoria } = preparar();
    expect((await casos.guardar({ sesion_horas: '8' }, ADMIN)).cambiados).toBe(0);
    expect(repositorio.guardar).not.toHaveBeenCalled();
    expect(auditoria.operacion).not.toHaveBeenCalled();
    expect(repositorio.recargar).toHaveBeenCalled();
  });
});

describe('Casos de uso · verificación de correo y correo saliente', () => {
  it('exigir la verificación de correo sin correo saliente → 400 sin guardar; con uno, se guarda', async () => {
    const sin = preparar();
    const e = await fallo(sin.casos.guardar({ registro_verificacion_email_habilitada: 'true' }, ADMIN));
    expect(e.tipo).toBe('validacion');
    expect(e.message).toMatch(/Configure el correo saliente \(SMTP\)/);
    expect(sin.repositorio.guardar).not.toHaveBeenCalled();
    const con = preparar({ origen: 'entorno' });
    expect((await con.casos.guardar({ registro_verificacion_email_habilitada: 'true' }, ADMIN)).cambiados).toBe(1);
    // Desactivarla nunca necesita correo
    const activa = preparar({ verificacion: 'true' });
    expect((await activa.casos.guardar({ registro_verificacion_email_habilitada: 'false' }, ADMIN)).cambiados).toBe(1);
  });

  it('consultar: la cuenta guardada sin la contraseña, de dónde sale hoy el correo y los perfiles', async () => {
    const { casos } = preparar({ guardado: GUARDADO, origen: 'sistema' });
    const r = await casos.consultarCorreo();
    expect(r).toMatchObject({ origen_vigente: 'sistema', cuenta_del_servidor: false, verificacion_exigida: false });
    expect(r.guardado).toMatchObject({ servidor: 'smtp.gmail.com', puerto: 587, seguridad: 'starttls', clave_guardada: true, clave_legible: true });
    expect(JSON.stringify(r)).not.toMatch(/clave_cifrada|enc\.v1/);
    expect(r.perfiles.google.servidor).toBe('smtp.gmail.com');
    expect((await preparar().casos.consultarCorreo()).guardado).toBeNull();
  });

  it('alta: cifra la contraseña de aplicación (sin espacios), audita sin ella y recarga el transporte', async () => {
    const { casos, correos, servicio, auditoria } = preparar();
    await casos.guardarCorreo({ servidor: 'smtp.gmail.com', puerto: '587', usuario: 'ANPR.Zonal3@gmail.com', clave: 'abcd efgh ijkl mnop' }, ADMIN);
    expect(servicio.cifrar).toHaveBeenCalledWith('abcdefghijklmnop');
    expect(correos.guardar).toHaveBeenCalledWith({
      servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', remitenteNombre: 'Sistema ANPR · ECU 911', remitenteCorreo: null, habilitado: true,
    }, 'enc.v1.prueba.16', ADMIN.id);
    const detalle = auditoria.operacion.mock.calls[0][4] as string;
    expect(detalle).toBe('Correo saliente: alta anpr.zonal3@gmail.com en smtp.gmail.com:587');
    expect(detalle).not.toMatch(/abcd/);
    expect(servicio.recargar).toHaveBeenCalled();
  });

  it('edición: la contraseña vacía conserva la guardada; si es ilegible hay que escribirla otra vez', async () => {
    const { casos, correos, servicio, auditoria } = preparar({ guardado: GUARDADO, origen: 'sistema' });
    await casos.guardarCorreo({ servidor: 'smtp.gmail.com', puerto: 465, usuario: 'anpr.zonal3@gmail.com', clave: '' }, ADMIN);
    expect(servicio.cifrar).not.toHaveBeenCalled();
    expect(correos.guardar).toHaveBeenCalledWith(expect.objectContaining({ puerto: 465 }), null, ADMIN.id);
    expect(auditoria.operacion.mock.calls[0][4]).toBe('Correo saliente: servidor smtp.gmail.com:465');
    const ilegible = preparar({ guardado: { ...GUARDADO, claveLegible: false } });
    expect((await fallo(ilegible.casos.guardarCorreo({ servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com' }, ADMIN))).message)
      .toBe('El campo «Contraseña» es obligatorio.');
  });

  it('no deja la verificación exigida sin correo: deshabilitar o quitar la cuenta → 409 salvo que el servidor tenga SMTP_*', async () => {
    const exigida = preparar({ verificacion: 'true', guardado: GUARDADO, origen: 'sistema' });
    expect((await fallo(exigida.casos.eliminarCorreo(ADMIN))).tipo).toBe('conflicto');
    expect((await fallo(exigida.casos.guardarCorreo({ servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', habilitado: false }, ADMIN))).tipo).toBe('conflicto');
    expect(exigida.correos.eliminar).not.toHaveBeenCalled();
    const respaldo = preparar({ verificacion: 'true', guardado: GUARDADO, origen: 'sistema', servidor: true });
    await respaldo.casos.eliminarCorreo(ADMIN);
    expect(respaldo.correos.eliminar).toHaveBeenCalled();
    expect(respaldo.auditoria.operacion).toHaveBeenCalledWith(ADMIN, 'CONFIGURACION_CORREO', 'configuracion', null, 'Correo saliente quitado (anpr.zonal3@gmail.com)');
    expect((await fallo(preparar().casos.eliminarCorreo(ADMIN))).tipo).toBe('no_encontrado');
  });

  it('prueba: por omisión al correo de quien la pide; el error del servidor se explica y se guarda como última prueba', async () => {
    const { casos, servicio, correos } = preparar({ guardado: GUARDADO, origen: 'sistema' });
    servicio.probar.mockResolvedValueOnce({ ok: false, error: 'Invalid login: 535-5.7.8 Username and Password not accepted' });
    const r = await casos.probarCorreo({}, ADMIN);
    expect(servicio.probar).toHaveBeenCalledWith('admin@ecu911.gob.ec', 'Administrador');
    expect(r.ok).toBe(false);
    expect(r.detalle).toMatch(/contraseña de aplicación de 16 letras/);
    expect(correos.registrarPrueba).toHaveBeenCalledWith(false, r.detalle);
    const bien = await casos.probarCorreo({ destino: 'guardia@ecu911.gob.ec' }, ADMIN);
    expect(bien).toMatchObject({ ok: true, detalle: 'Correo de prueba enviado a guardia@ecu911.gob.ec.' });
    expect((await fallo(casos.probarCorreo({ destino: 'no-es-correo' }, ADMIN))).tipo).toBe('validacion');
    expect((await fallo(preparar().casos.probarCorreo({}, ADMIN))).tipo).toBe('conflicto');
  });
});
