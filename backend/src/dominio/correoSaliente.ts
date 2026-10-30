import { type Validado, validarEmail, validarEntero, validarHost, validarTexto } from './validacion';

/**
 * Correo saliente del sistema (SMTP): verificación de cuentas, recuperación de contraseña,
 * cuentas creadas por el administrador y alarmas escaladas. Lo configura el administrador en
 * Configuración y se guarda en la tabla ConfiguracionCorreo (una sola fila) con la contraseña
 * cifrada; sin esa fila rigen las variables SMTP_* del servidor.
 *
 * Gmail o Google Workspace: servidor smtp.gmail.com, puerto 587 (STARTTLS) o 465 (SSL), la
 * cuenta como usuario y una contraseña de aplicación de 16 letras (Google exige la verificación
 * en dos pasos para crearla; la contraseña normal de la cuenta no sirve).
 */

export const PERFILES_SMTP = {
  google: { etiqueta: 'Gmail / Google Workspace', servidor: 'smtp.gmail.com', puerto: 587 },
  microsoft: { etiqueta: 'Outlook / Microsoft 365', servidor: 'smtp.office365.com', puerto: 587 },
} as const;

export const REMITENTE_POR_OMISION = 'Sistema ANPR · ECU 911';

/** Servidores de Google: su contraseña de aplicación son 16 letras que Google muestra en grupos de 4. */
export const esServidorGoogle = (servidor: string) => /(^|\.)(gmail|googlemail)\.com$/i.test(servidor.trim());

/** Puerto 465: SSL desde la conexión; los demás (587, 25, 2525) negocian STARTTLS. */
export const seguridadDePuerto = (puerto: number): 'ssl' | 'starttls' => (puerto === 465 ? 'ssl' : 'starttls');

export interface DatosCorreoSaliente {
  servidor: string;
  puerto: number;
  usuario: string;
  /** Contraseña en claro, solo mientras se valida y cifra; null = conservar la guardada */
  clave: string | null;
  remitenteNombre: string;
  /** Dirección del remitente; null = la cuenta (Gmail solo acepta la cuenta o un alias verificado) */
  remitenteCorreo: string | null;
  habilitado: boolean;
}

const error = (mensaje: string): { ok: false; error: string } => ({ ok: false, error: mensaje });

/**
 * Valida el formulario del correo saliente. La contraseña es obligatoria la primera vez; después,
 * vacía conserva la guardada (la API nunca la devuelve). En Google se quitan los espacios con que
 * se muestra la contraseña de aplicación y se exigen sus 16 letras.
 */
export function leerCorreoSaliente(entrada: Record<string, unknown>, hayClaveGuardada: boolean): Validado<DatosCorreoSaliente> {
  const servidor = validarHost(entrada.servidor, 'Servidor SMTP');
  if (!servidor.ok) return servidor;
  if (!servidor.valor) return error('El campo «Servidor SMTP» es obligatorio.');
  const puerto = validarEntero(entrada.puerto, { etiqueta: 'Puerto', min: 1, max: 65535, requerido: true });
  if (!puerto.ok) return puerto;
  const usuario = validarEmail(entrada.usuario, 'Correo de la cuenta');
  if (!usuario.ok) return usuario;

  let clave: string | null = null;
  const escrita = typeof entrada.clave === 'string' ? entrada.clave : entrada.clave == null ? '' : null;
  if (escrita === null) return error('Contraseña: valor inválido.');
  if (escrita.trim()) {
    if (esServidorGoogle(servidor.valor)) {
      clave = escrita.replace(/\s+/g, '');
      if (!/^[A-Za-z]{16}$/.test(clave)) {
        return error('Contraseña de aplicación de Google: son 16 letras (los espacios no importan). No use la contraseña de la cuenta.');
      }
    } else {
      clave = escrita.trim();
      // eslint-disable-next-line no-control-regex
      if (clave.length > 128 || /[\u0000-\u001F\u007F]/.test(clave)) return error('Contraseña: hasta 128 caracteres, sin caracteres de control.');
    }
  } else if (!hayClaveGuardada) {
    return error('El campo «Contraseña» es obligatorio.');
  }

  const nombre = validarTexto(entrada.remitente_nombre, { etiqueta: 'Nombre del remitente', tipo: 'libre', max: 100 });
  if (!nombre.ok) return nombre;
  if (nombre.valor && /["\\]/.test(nombre.valor)) return error('Nombre del remitente: sin comillas ni barras invertidas.');
  const vacio = entrada.remitente_correo == null || String(entrada.remitente_correo).trim() === '';
  const remitente = vacio ? null : validarEmail(entrada.remitente_correo, 'Correo del remitente');
  if (remitente && !remitente.ok) return remitente;
  if (entrada.habilitado !== undefined && typeof entrada.habilitado !== 'boolean') return error('Habilitado: debe ser verdadero o falso.');

  return {
    ok: true,
    valor: {
      servidor: servidor.valor.toLowerCase(), puerto: puerto.valor as number, usuario: usuario.valor, clave,
      remitenteNombre: nombre.valor ?? REMITENTE_POR_OMISION, remitenteCorreo: remitente?.valor ?? null,
      habilitado: entrada.habilitado !== false,
    },
  };
}

/** Qué cambió (para la auditoría): nunca incluye la contraseña, solo que se cambió. */
export function cambiosCorreoSaliente(
  anterior: Omit<DatosCorreoSaliente, 'clave'> | null, nuevo: DatosCorreoSaliente,
): string[] {
  if (!anterior) return [`alta ${nuevo.usuario} en ${nuevo.servidor}:${nuevo.puerto}`];
  const cambios: string[] = [];
  if (anterior.servidor !== nuevo.servidor || anterior.puerto !== nuevo.puerto) cambios.push(`servidor ${nuevo.servidor}:${nuevo.puerto}`);
  if (anterior.usuario !== nuevo.usuario) cambios.push(`cuenta ${nuevo.usuario}`);
  if (nuevo.clave !== null) cambios.push('contraseña cambiada');
  if (anterior.remitenteNombre !== nuevo.remitenteNombre || anterior.remitenteCorreo !== nuevo.remitenteCorreo) cambios.push('remitente');
  if (anterior.habilitado !== nuevo.habilitado) cambios.push(nuevo.habilitado ? 'habilitado' : 'deshabilitado');
  return cambios;
}

/**
 * Error del servidor SMTP en palabras del administrador. Los de Google traen códigos conocidos:
 * 535 5.7.8 (usuario o contraseña rechazados) y 534 5.7.9 (hace falta una contraseña de aplicación).
 */
export function explicarErrorSmtp(mensaje: string): string {
  const m = mensaje || '';
  if (/534|5\.7\.9|Application-specific password/i.test(m)) {
    return 'La cuenta exige una contraseña de aplicación: active la verificación en dos pasos y cree una en myaccount.google.com/apppasswords.';
  }
  if (/535|5\.7\.8|Username and Password not accepted|Invalid login|authentication failed/i.test(m)) {
    return 'El servidor rechazó la cuenta o la contraseña. En Gmail use una contraseña de aplicación de 16 letras, no la de la cuenta.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return 'No se encontró el servidor SMTP: revise el nombre del servidor o la conexión a internet.';
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|timeout/i.test(m)) return 'El servidor SMTP no respondió en ese puerto: pruebe 587 (STARTTLS) o 465 (SSL), o revise el firewall.';
  if (/wrong version number|ssl3_get_record|SSL routines/i.test(m)) return 'El puerto no coincide con el cifrado: use 465 para SSL o 587 para STARTTLS.';
  if (/certificate|self[- ]signed/i.test(m)) return 'El certificado TLS del servidor no es válido.';
  return `El servidor SMTP respondió: ${m.slice(0, 200)}`;
}
