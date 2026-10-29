import { errorDe, validarEmail, validarEntero, validarHost, validarTexto } from './validacion';

/**
 * Correo saliente (SMTP) de Configuración: las mismas reglas que valida el backend
 * (backend/src/dominio/correoSaliente.ts), para avisar mientras se escribe.
 */

export type PerfilSmtp = 'google' | 'microsoft' | 'otro';

export const PERFILES_SMTP: Record<Exclude<PerfilSmtp, 'otro'>, { etiqueta: string; servidor: string; puerto: number }> = {
  google: { etiqueta: 'Gmail / Google Workspace', servidor: 'smtp.gmail.com', puerto: 587 },
  microsoft: { etiqueta: 'Outlook / Microsoft 365', servidor: 'smtp.office365.com', puerto: 587 },
};

export const REMITENTE_POR_OMISION = 'Sistema ANPR · ECU 911';

export const esServidorGoogle = (servidor: string) => /(^|\.)(gmail|googlemail)\.com$/i.test(servidor.trim());

export function perfilDe(servidor: string): PerfilSmtp {
  const s = servidor.trim().toLowerCase();
  if (esServidorGoogle(s)) return 'google';
  if (s === PERFILES_SMTP.microsoft.servidor) return 'microsoft';
  return 'otro';
}

export interface FormularioCorreo {
  servidor: string;
  puerto: string;
  usuario: string;
  clave: string;
  remitente_nombre: string;
  remitente_correo: string;
}

/** Errores por campo. `hayClaveGuardada`: la contraseña vacía conserva la guardada. */
export function erroresCorreo(f: FormularioCorreo, hayClaveGuardada: boolean): Record<keyof FormularioCorreo, string | null> {
  const servidor = validarHost(f.servidor, 'Servidor SMTP');
  const clave = f.clave.trim();
  let errorClave: string | null = null;
  if (!clave) errorClave = hayClaveGuardada ? null : 'El campo «Contraseña» es obligatorio.';
  else if (esServidorGoogle(f.servidor)) {
    if (!/^[A-Za-z]{16}$/.test(f.clave.replace(/\s+/g, ''))) errorClave = 'Contraseña de aplicación de Google: son 16 letras (los espacios no importan). No use la contraseña de la cuenta.';
  } else if (clave.length > 128) errorClave = 'Contraseña: hasta 128 caracteres.';
  const nombre = validarTexto(f.remitente_nombre, { etiqueta: 'Nombre del remitente', tipo: 'libre', max: 100 });
  return {
    servidor: !servidor.ok ? servidor.error : servidor.valor ? null : 'El campo «Servidor SMTP» es obligatorio.',
    puerto: errorDe(validarEntero(f.puerto, { etiqueta: 'Puerto', min: 1, max: 65535, requerido: true })),
    usuario: errorDe(validarEmail(f.usuario, 'Correo de la cuenta')),
    clave: errorClave,
    remitente_nombre: errorDe(nombre) ?? (/["\\]/.test(f.remitente_nombre) ? 'Nombre del remitente: sin comillas ni barras invertidas.' : null),
    remitente_correo: f.remitente_correo.trim() ? errorDe(validarEmail(f.remitente_correo, 'Correo del remitente')) : null,
  };
}

export const seguridadDePuerto = (puerto: string) => (puerto.trim() === '465' ? 'SSL desde la conexión' : 'STARTTLS');
