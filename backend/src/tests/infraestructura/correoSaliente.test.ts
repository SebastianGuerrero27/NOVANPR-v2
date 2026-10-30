/**
 * Correo saliente en la infraestructura: la cuenta de Configuración tiene prioridad sobre las
 * variables SMTP_*, la contraseña se guarda cifrada y el correo de prueba sale con el remitente
 * configurado (nodemailer simulado: no se conecta a ningún servidor).
 */
import crypto from 'crypto';

const mockEnvios: Record<string, unknown>[] = [];
const mockTransportes: Record<string, any>[] = [];
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: (opciones: Record<string, unknown>) => {
      mockTransportes.push(opciones);
      return { sendMail: async (m: Record<string, unknown>) => { mockEnvios.push(m); }, close: () => undefined };
    },
  },
}));

import { cifrarSecreto, descifrarSecreto, reiniciarClave, secretoConClaveVigente } from '../../infraestructura/servicios/custodiaCredenciales';
import { cuentaDelServidor, cuentaVigente, emailService, fijarCuentaGuardada } from '../../infraestructura/servicios/emailService';

const ENTORNO = { ...process.env };
afterEach(() => {
  process.env = { ...ENTORNO };
  fijarCuentaGuardada(null);
  reiniciarClave();
  mockEnvios.length = 0;
  mockTransportes.length = 0;
});

const GUARDADA = {
  servidor: 'smtp.gmail.com', puerto: 465, usuario: 'anpr.zonal3@gmail.com', clave: 'abcdefghijklmnop',
  remitenteNombre: 'Garita ECU 911', remitenteCorreo: 'anpr.zonal3@gmail.com', origen: 'sistema' as const,
};

describe('Correo saliente · cuenta vigente', () => {
  it('sin cuenta guardada rigen las variables SMTP_* (contraseña sin espacios, remitente de SMTP_FROM)', () => {
    Object.assign(process.env, { SMTP_USER: 'env@gmail.com', SMTP_PASSWORD: 'wxyz wxyz wxyz wxyz', SMTP_FROM: 'Garita <garita@gmail.com>' });
    delete process.env.SMTP_HOST; delete process.env.SMTP_PORT;
    expect(cuentaVigente()).toEqual({
      servidor: 'smtp.gmail.com', puerto: 587, usuario: 'env@gmail.com', clave: 'wxyzwxyzwxyzwxyz',
      remitenteNombre: 'Sistema ANPR · ECU 911', remitenteCorreo: 'garita@gmail.com', origen: 'entorno',
    });
    expect(emailService.smtpConfigurado()).toBe(true);
  });

  it('la cuenta de Configuración tiene prioridad; al quitarla vuelven a regir las variables', () => {
    Object.assign(process.env, { SMTP_USER: 'env@gmail.com', SMTP_PASSWORD: 'clave' });
    fijarCuentaGuardada(GUARDADA);
    expect(cuentaVigente()?.origen).toBe('sistema');
    fijarCuentaGuardada(null);
    expect(cuentaVigente()?.origen).toBe('entorno');
    delete process.env.SMTP_USER;
    expect(cuentaDelServidor()).toBeNull();
    expect(emailService.smtpConfigurado()).toBe(false);
  });

  it('el correo de prueba sale con la cuenta y el remitente de Configuración (465 = SSL)', async () => {
    fijarCuentaGuardada(GUARDADA);
    expect(await emailService.probar('admin@ecu911.gob.ec', 'Administrador')).toEqual({ ok: true });
    expect(mockTransportes[0]).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'anpr.zonal3@gmail.com', pass: 'abcdefghijklmnop' } });
    expect(mockEnvios[0]).toMatchObject({ from: '"Garita ECU 911" <anpr.zonal3@gmail.com>', to: 'admin@ecu911.gob.ec', subject: 'Prueba de correo · Sistema ANPR ECU 911' });
  });

  it('sin ninguna cuenta la prueba falla sin intentar conectarse', async () => {
    delete process.env.SMTP_USER; delete process.env.SMTP_PASSWORD;
    expect(await emailService.probar('admin@ecu911.gob.ec', 'Administrador')).toEqual({ ok: false, error: 'No hay correo saliente configurado.' });
    expect(mockTransportes).toHaveLength(0);
  });
});

describe('Correo saliente · contraseña cifrada', () => {
  it('cifra con AES-256-GCM (texto distinto cada vez) y solo la clave configurada la descifra', () => {
    process.env.CAMARAS_CLAVE_CIFRADO = crypto.randomBytes(32).toString('base64');
    reiniciarClave();
    const a = cifrarSecreto('abcdefghijklmnop');
    const b = cifrarSecreto('abcdefghijklmnop');
    expect(a).toMatch(/^enc\.v1\./);
    expect(a).not.toBe(b);
    expect(a).not.toContain('abcdefghijklmnop');
    expect(descifrarSecreto(a)).toBe('abcdefghijklmnop');
    expect(() => descifrarSecreto(`${a.slice(0, -4)}AAAA`)).toThrow(/ilegible/);
    expect(() => descifrarSecreto('abcdefghijklmnop')).toThrow(/no está cifrado/);
  });

  it('al cambiar la clave, la anterior aún descifra y secretoConClaveVigente la vuelve a cifrar con la nueva', () => {
    const vieja = crypto.randomBytes(32).toString('base64');
    process.env.CAMARAS_CLAVE_CIFRADO = vieja;
    reiniciarClave();
    const cifrada = cifrarSecreto('abcdefghijklmnop');
    Object.assign(process.env, { CAMARAS_CLAVE_CIFRADO: crypto.randomBytes(32).toString('base64'), CAMARAS_CLAVE_CIFRADO_ANTERIOR: vieja });
    reiniciarClave();
    const nueva = secretoConClaveVigente(cifrada);
    expect(nueva).not.toBe(cifrada);
    expect(secretoConClaveVigente(nueva)).toBe(nueva);
    delete process.env.CAMARAS_CLAVE_CIFRADO_ANTERIOR;
    reiniciarClave();
    expect(descifrarSecreto(nueva)).toBe('abcdefghijklmnop');
    expect(() => descifrarSecreto(cifrada)).toThrow(/ilegible/);
  });
});
