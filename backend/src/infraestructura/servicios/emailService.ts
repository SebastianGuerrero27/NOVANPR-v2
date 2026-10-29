import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';

/**
 * Correo institucional del sistema ANPR (verificación de cuenta, recuperación de
 * contraseña y notificaciones de seguridad). Adaptado del servicio SMTP de la
 * plataforma Vigilance Heart, con dos cambios de seguridad:
 *   - Se mantiene la verificación del certificado TLS (SMTP_TLS_INSECURE=true solo para
 *     servidores internos con certificado autofirmado).
 *   - Nunca se envían contraseñas por correo: solo enlaces de un solo uso.
 *
 * Cuenta SMTP: la que el administrador guarda en Configuración (tabla ConfiguracionCorreo,
 * contraseña cifrada; la carga infraestructura/persistencia/configuracionCorreoSql.ts) y, si
 * no hay una habilitada, la de las variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD y
 * SMTP_FROM. Sin ninguna (desarrollo) el mensaje se escribe en la consola del backend, incluido
 * el enlace, para poder completar los flujos sin servidor de correo.
 */

/** Cuenta con la que sale el correo y de dónde viene. */
export interface CuentaSmtp {
  servidor: string;
  puerto: number;
  usuario: string;
  clave: string;
  remitenteNombre: string;
  remitenteCorreo: string;
  origen: 'sistema' | 'entorno';
}

let guardada: CuentaSmtp | null = null;
let transporter: Transporter | null = null;
let configKey = '';

/** Cuenta definida en Configuración; null (sin fila o deshabilitada) deja regir las variables SMTP_*. */
export function fijarCuentaGuardada(cuenta: CuentaSmtp | null): void {
  guardada = cuenta;
}

/** Cuenta de las variables SMTP_* del servidor (null si faltan el usuario o la contraseña). */
export function cuentaDelServidor(): CuentaSmtp | null {
  const usuario = (process.env.SMTP_USER || '').trim();
  const clave = (process.env.SMTP_PASSWORD || '').replace(/\s+/g, '');
  if (!usuario || !clave) return null;
  return {
    servidor: (process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
    puerto: parseInt(process.env.SMTP_PORT || '587', 10),
    usuario, clave,
    remitenteNombre: 'Sistema ANPR · ECU 911',
    remitenteCorreo: process.env.SMTP_FROM?.match(/[^<\s]+@[^>\s]+/)?.[0] || usuario,
    origen: 'entorno',
  };
}

export const cuentaVigente = (): CuentaSmtp | null => guardada ?? cuentaDelServidor();

function smtpConfigurado(): boolean {
  return cuentaVigente() !== null;
}

function crearTransporte(c: CuentaSmtp): Transporter {
  return nodemailer.createTransport({
    host: c.servidor,
    port: c.puerto,
    secure: c.puerto === 465,
    auth: { user: c.usuario, pass: c.clave },
    tls: { rejectUnauthorized: process.env.SMTP_TLS_INSECURE !== 'true' },
    // Un servidor que no responde no debe dejar colgados la prueba ni los envíos
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
}

function getTransporter(): Transporter | null {
  const c = cuentaVigente();
  if (!c) return null;
  const key = `${c.origen}:${c.servidor}:${c.puerto}:${c.usuario}:${c.clave}`;
  if (transporter && configKey === key) return transporter;
  transporter?.close();
  transporter = crearTransporte(c);
  configKey = key;
  console.log(`[EMAIL] Transporte SMTP configurado: ${c.servidor}:${c.puerto} (${c.usuario}, ${c.origen === 'sistema' ? 'Configuración' : 'variables SMTP_*'})`);
  return transporter;
}

const remitenteDe = (c: CuentaSmtp) => `"${c.remitenteNombre}" <${c.remitenteCorreo}>`;

function logoAdjunto(): SendMailOptions['attachments'] {
  const candidatos = [
    path.resolve(__dirname, '../../assets/ECU911.svg.png'),
    path.resolve(process.cwd(), 'assets/ECU911.svg.png'),
    '/app/assets/ECU911.svg.png',
  ];
  const p = candidatos.find(c => fs.existsSync(c));
  return p ? [{ filename: 'ECU911.png', content: fs.readFileSync(p), cid: 'ecu911logo', contentType: 'image/png' }] : [];
}

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

interface Contenido {
  etiqueta: string;
  titulo: string;
  parrafos: string[];         // HTML ya escapado
  boton?: { texto: string; url: string };
  aviso?: string;             // HTML ya escapado
  nota?: string;
}

/** Plantilla institucional única (cabecera ECU 911, cuerpo, botón, aviso y pie). */
function plantilla(c: Contenido): string {
  const boton = c.boton
    ? `<table role="presentation" width="100%" style="margin:24px 0 28px 0"><tr><td align="center">
         <a href="${c.boton.url}" target="_blank" style="background-color:#b91c1c;color:#ffffff;padding:14px 30px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;display:inline-block;text-transform:uppercase;letter-spacing:0.5px">${escapar(c.boton.texto)}</a>
       </td></tr></table>
       <p style="font-size:11px;color:#64748b;margin:0 0 16px 0;word-break:break-all">Si el botón no funciona, copie este enlace en su navegador:<br>${escapar(c.boton.url)}</p>`
    : '';
  const aviso = c.aviso
    ? `<table role="presentation" width="100%" style="background-color:#fffbeb;border-left:4px solid #f59e0b;margin:16px 0"><tr>
         <td style="font-size:12px;color:#92400e;line-height:1.5;padding:12px 16px">${c.aviso}</td></tr></table>`
    : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapar(c.titulo)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b">
<table role="presentation" width="100%" style="background-color:#f1f5f9;padding:32px 10px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
  <tr><td style="background-color:#071730;padding:28px 24px 22px 24px;text-align:center;border-bottom:4px solid #b91c1c">
    <div style="background-color:#ffffff;padding:8px 18px;border-radius:10px;display:inline-block;margin-bottom:12px"><img src="cid:ecu911logo" alt="ECU 911" style="height:48px;width:auto;display:block"></div>
    <div style="font-size:11px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;font-weight:600">República del Ecuador</div>
    <div style="font-size:17px;color:#ffffff;font-weight:800;margin-top:4px">SERVICIO INTEGRADO DE SEGURIDAD ECU 911</div>
    <div style="font-size:12px;color:#cbd5e1;margin-top:2px">Sistema ANPR de Control de Ingreso Vehicular · Coordinación Zonal 3</div>
  </td></tr>
  <tr><td style="padding:32px 32px 24px 32px">
    <div style="font-size:12px;font-weight:bold;color:#b91c1c;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${escapar(c.etiqueta)}</div>
    <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 16px 0">${escapar(c.titulo)}</h2>
    ${c.parrafos.map(p => `<p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 14px 0">${p}</p>`).join('')}
    ${boton}${aviso}
    ${c.nota ? `<p style="font-size:12px;line-height:1.5;color:#64748b;margin:16px 0 0 0">${c.nota}</p>` : ''}
  </td></tr>
  <tr><td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="font-size:12px;font-weight:700;color:#071730;margin:0 0 4px 0">Servicio Integrado de Seguridad ECU 911</p>
    <p style="font-size:11px;color:#64748b;margin:0 0 6px 0">Coordinación Zonal 3 · Ambato, Tungurahua</p>
    <p style="font-size:10px;color:#94a3b8;margin:0">Mensaje automático del Sistema ANPR. No responda a este correo. © ${new Date().getFullYear()} ECU 911.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function textoPlano(c: Contenido): string {
  const limpio = (h: string) => h.replace(/<[^>]+>/g, '');
  return [c.titulo, '', ...c.parrafos.map(limpio), c.boton ? `${c.boton.texto}: ${c.boton.url}` : '', c.aviso ? limpio(c.aviso) : '', c.nota ? limpio(c.nota) : '']
    .filter(Boolean).join('\n');
}

async function enviar(para: string, asunto: string, c: Contenido): Promise<boolean> {
  const t = getTransporter();
  const cuenta = cuentaVigente();
  if (!t || !cuenta) {
    console.log(`\n[EMAIL · modo desarrollo sin SMTP] Para: ${para}\n  Asunto: ${asunto}\n${textoPlano(c)}\n`);
    return true;
  }
  try {
    await t.sendMail({
      from: remitenteDe(cuenta),
      to: para,
      subject: asunto,
      html: plantilla(c),
      text: textoPlano(c),
      attachments: logoAdjunto(),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
    });
    return true;
  } catch (error: any) {
    console.error(`[EMAIL] No se pudo enviar "${asunto}" a ${para}: ${error.message}`);
    return false;
  }
}

/**
 * Correo de prueba con la cuenta vigente, con un transporte nuevo (no el compartido): el error
 * del servidor vuelve al administrador para que corrija la cuenta.
 */
async function probar(para: string, nombre: string): Promise<{ ok: boolean; error?: string }> {
  const cuenta = cuentaVigente();
  if (!cuenta) return { ok: false, error: 'No hay correo saliente configurado.' };
  const t = crearTransporte(cuenta);
  const c: Contenido = {
    etiqueta: 'Prueba de correo',
    titulo: 'El correo saliente funciona',
    parrafos: [
      `Estimado/a <strong>${escapar(nombre)}</strong>:`,
      'Este mensaje confirma que el Sistema ANPR puede enviar correos: verificación de cuentas, recuperación de contraseñas y alarmas escaladas.',
      `Servidor <strong>${escapar(cuenta.servidor)}:${cuenta.puerto}</strong> · cuenta <strong>${escapar(cuenta.usuario)}</strong>.`,
    ],
    nota: 'Lo envió un administrador desde Configuración › Correo saliente.',
  };
  try {
    await t.sendMail({
      from: remitenteDe(cuenta), to: para, subject: 'Prueba de correo · Sistema ANPR ECU 911',
      html: plantilla(c), text: textoPlano(c), attachments: logoAdjunto(),
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'OOF, AutoReply' },
    });
    return { ok: true };
  } catch (error: any) {
    console.error(`[EMAIL] Prueba fallida (${cuenta.servidor}:${cuenta.puerto}): ${error.message}`);
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    t.close();
  }
}

export const emailService = {
  smtpConfigurado,
  probar,

  verificacionCuenta(email: string, nombre: string, enlace: string, horas: number) {
    return enviar(email, 'Verifique su correo · Sistema ANPR ECU 911', {
      etiqueta: 'Activación de cuenta',
      titulo: 'Confirme su correo institucional',
      parrafos: [
        `Estimado/a <strong>${escapar(nombre)}</strong>:`,
        `Se registró una cuenta en el <strong>Sistema ANPR de Control de Ingreso Vehicular</strong> con este correo. Para activarla, confirme su dirección:`,
      ],
      boton: { texto: 'Verificar mi correo', url: enlace },
      aviso: `<strong>Vigencia:</strong> este enlace es válido por <strong>${horas} horas</strong> y solo puede usarse una vez.`,
      nota: 'Si usted no realizó este registro, ignore este mensaje: la cuenta no se activará.',
    });
  },

  restablecerPassword(email: string, nombre: string, enlace: string, minutos: number) {
    return enviar(email, 'Restablecimiento de contraseña · Sistema ANPR ECU 911', {
      etiqueta: 'Seguridad de la cuenta',
      titulo: 'Restablecimiento de contraseña',
      parrafos: [
        `Estimado/a <strong>${escapar(nombre)}</strong>:`,
        'Recibimos una solicitud para restablecer la contraseña de su cuenta. Para definir una nueva, use el siguiente botón:',
      ],
      boton: { texto: 'Restablecer contraseña', url: enlace },
      aviso: `<strong>Vigencia:</strong> este enlace es válido por <strong>${minutos} minutos</strong> y solo puede usarse una vez.`,
      nota: 'Si usted no lo solicitó, ignore este mensaje: su contraseña actual no cambiará.',
    });
  },

  definirPasswordCuentaNueva(email: string, nombre: string, enlace: string, horas: number, rol: string) {
    return enviar(email, 'Su cuenta en el Sistema ANPR · ECU 911', {
      etiqueta: 'Cuenta creada por un administrador',
      titulo: 'Defina su contraseña',
      parrafos: [
        `Estimado/a <strong>${escapar(nombre)}</strong>:`,
        `Un administrador creó su cuenta en el Sistema ANPR con el rol <strong>${escapar(rol)}</strong>. Para ingresar, defina su contraseña:`,
      ],
      boton: { texto: 'Definir contraseña', url: enlace },
      aviso: `<strong>Vigencia:</strong> este enlace es válido por <strong>${horas} horas</strong>.`,
    });
  },

  passwordCambiada(email: string, nombre: string) {
    return enviar(email, 'Su contraseña fue cambiada · Sistema ANPR ECU 911', {
      etiqueta: 'Notificación de seguridad',
      titulo: 'Contraseña actualizada',
      parrafos: [
        `Estimado/a <strong>${escapar(nombre)}</strong>:`,
        `La contraseña de su cuenta se cambió el ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}.`,
      ],
      aviso: 'Si usted <strong>no</strong> realizó este cambio, comuníquese de inmediato con el administrador del sistema.',
    });
  },

  alarmaEscalada(email: string, nombre: string, titulo: string, mensaje: string, enlace: string) {
    return enviar(email, `Alarma sin atender · ${titulo.substring(0, 80)} · Sistema ANPR ECU 911`, {
      etiqueta: 'Alarma escalada',
      titulo,
      parrafos: [
        `Estimado/a <strong>${escapar(nombre)}</strong>:`,
        escapar(mensaje),
        'La alarma no fue reconocida por el personal en el tiempo configurado. Revísela y regístrela como atendida.',
      ],
      boton: { texto: 'Abrir en el sistema', url: enlace },
      aviso: 'Este correo se envía porque su rol recibe las alarmas escaladas del sistema ANPR.',
    });
  },

  cuentaBloqueada(email: string, nombre: string, minutos: number) {
    return enviar(email, 'Cuenta bloqueada temporalmente · Sistema ANPR ECU 911', {
      etiqueta: 'Notificación de seguridad',
      titulo: 'Cuenta bloqueada por intentos fallidos',
      parrafos: [
        `Estimado/a <strong>${escapar(nombre)}</strong>:`,
        `Su cuenta se bloqueó durante <strong>${minutos} minutos</strong> por varios intentos de inicio de sesión fallidos.`,
      ],
      aviso: 'Si no fue usted, restablezca su contraseña y avise al administrador del sistema.',
    });
  },
};
