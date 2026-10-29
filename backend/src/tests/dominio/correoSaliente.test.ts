import { cambiosCorreoSaliente, explicarErrorSmtp, leerCorreoSaliente, seguridadDePuerto } from '../../dominio/correoSaliente';

/** Formulario del correo saliente (SMTP): reglas de Google, contraseña guardada y auditoría sin secretos. */

const GMAIL = { servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', clave: 'abcd efgh ijkl mnop' };
const error = (entrada: Record<string, unknown>, guardada = false) => {
  const r = leerCorreoSaliente(entrada, guardada);
  return r.ok ? null : r.error;
};

describe('Correo saliente · formulario', () => {
  it('Gmail: quita los espacios de la contraseña de aplicación y completa remitente y estado por omisión', () => {
    const r = leerCorreoSaliente({ ...GMAIL, usuario: ' ANPR.Zonal3@Gmail.com ', servidor: 'SMTP.GMAIL.COM' }, false);
    expect(r).toEqual({ ok: true, valor: {
      servidor: 'smtp.gmail.com', puerto: 587, usuario: 'anpr.zonal3@gmail.com', clave: 'abcdefghijklmnop',
      remitenteNombre: 'Sistema ANPR · ECU 911', remitenteCorreo: null, habilitado: true,
    } });
  });

  it('Gmail: la contraseña de la cuenta (no de aplicación) se rechaza con la explicación', () => {
    for (const clave of ['MiClave2026!', 'abcdefghijklmno', 'abcd efgh ijkl mnop q']) {
      expect(error({ ...GMAIL, clave })).toMatch(/16 letras/);
    }
  });

  it('otro servidor: la contraseña se conserva tal cual (con símbolos y espacios internos)', () => {
    const r = leerCorreoSaliente({ servidor: 'mail.ecu911.gob.ec', puerto: 465, usuario: 'anpr@ecu911.gob.ec', clave: ' Ecu 911#2026 ' }, false);
    expect(r.ok && r.valor.clave).toBe('Ecu 911#2026');
    expect(error({ servidor: 'mail.ecu911.gob.ec', puerto: 25, usuario: 'anpr@ecu911.gob.ec', clave: 'a\u0007b' })).toMatch(/caracteres de control/);
  });

  it('contraseña: obligatoria la primera vez; vacía conserva la guardada (null)', () => {
    expect(error({ ...GMAIL, clave: '' })).toBe('El campo «Contraseña» es obligatorio.');
    expect(error({ ...GMAIL, clave: undefined })).toBe('El campo «Contraseña» es obligatorio.');
    const r = leerCorreoSaliente({ ...GMAIL, clave: '   ' }, true);
    expect(r.ok && r.valor.clave).toBeNull();
    expect(error({ ...GMAIL, clave: 1234 })).toBe('Contraseña: valor inválido.');
  });

  it.each([
    [{ servidor: '' }, 'El campo «Servidor SMTP» es obligatorio.'],
    [{ servidor: 'smtp gmail' }, 'Servidor SMTP inválido.'],
    [{ puerto: 0 }, 'Puerto: mínimo 1.'],
    [{ puerto: '70000' }, 'Puerto: máximo 65535.'],
    [{ puerto: '58a' }, 'Puerto: solo números enteros.'],
    [{ usuario: 'anpr' }, 'Correo de la cuenta inválido.'],
    [{ remitente_correo: 'no-es-correo' }, 'Correo del remitente inválido.'],
    [{ remitente_nombre: 'Sistema "ANPR"' }, 'Nombre del remitente: sin comillas ni barras invertidas.'],
    [{ habilitado: 'si' }, 'Habilitado: debe ser verdadero o falso.'],
  ])('rechaza %j', (cambio, mensaje) => {
    expect(error({ ...GMAIL, ...cambio })).toBe(mensaje);
  });

  it('puerto 465 es SSL; 587 y los demás negocian STARTTLS', () => {
    expect(seguridadDePuerto(465)).toBe('ssl');
    expect(seguridadDePuerto(587)).toBe('starttls');
  });

  it('auditoría: describe lo que cambió sin mostrar nunca la contraseña', () => {
    const nuevo = { servidor: 'smtp.gmail.com', puerto: 465, usuario: 'otra@gmail.com', clave: 'abcdefghijklmnop',
      remitenteNombre: 'ANPR', remitenteCorreo: null, habilitado: false };
    const anterior = { ...nuevo, puerto: 587, usuario: 'anpr.zonal3@gmail.com', remitenteNombre: 'Sistema ANPR · ECU 911', habilitado: true };
    const cambios = cambiosCorreoSaliente(anterior, nuevo);
    expect(cambios).toEqual(['servidor smtp.gmail.com:465', 'cuenta otra@gmail.com', 'contraseña cambiada', 'remitente', 'deshabilitado']);
    expect(cambios.join(' ')).not.toMatch(/abcdefghijklmnop/);
    expect(cambiosCorreoSaliente(null, nuevo)).toEqual(['alta otra@gmail.com en smtp.gmail.com:465']);
    expect(cambiosCorreoSaliente({ ...nuevo }, { ...nuevo, clave: null })).toEqual([]);
  });

  it('explica en palabras del administrador los errores típicos del servidor', () => {
    expect(explicarErrorSmtp('534-5.7.9 Application-specific password required')).toMatch(/verificación en dos pasos/);
    expect(explicarErrorSmtp('Invalid login: 535-5.7.8 Username and Password not accepted')).toMatch(/contraseña de aplicación/);
    expect(explicarErrorSmtp('getaddrinfo ENOTFOUND smtp.gmial.com')).toMatch(/No se encontró el servidor/);
    expect(explicarErrorSmtp('connect ETIMEDOUT 142.250.0.108:25')).toMatch(/587/);
    expect(explicarErrorSmtp('ssl3_get_record:wrong version number')).toMatch(/465 para SSL/);
    expect(explicarErrorSmtp('x'.repeat(400))).toHaveLength('El servidor SMTP respondió: '.length + 200);
  });
});
