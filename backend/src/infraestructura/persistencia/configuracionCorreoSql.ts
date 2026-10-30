import sql from '../postgres';
import { getDB } from '../db';
import type { CorreoGuardado, RepositorioCorreoSaliente } from '../../aplicacion/configuracion';
import { descifrarSecreto, secretoConClaveVigente } from '../servicios/custodiaCredenciales';
import { fijarCuentaGuardada } from '../servicios/emailService';

/**
 * Correo saliente guardado en Configuración (tabla ConfiguracionCorreo, una sola fila con id 1).
 * La contraseña se guarda cifrada con la clave de las credenciales (custodiaCredenciales.ts) y
 * solo se descifra para entregarla al transporte SMTP en memoria (emailService.ts).
 */

const SELECT = `
  SELECT c.servidor, c.puerto, c.usuario, c.clave_cifrada, c.remitente_nombre, c.remitente_correo, c.habilitado,
         c.fecha_actualizacion, u.email AS actualizado_por, c.ultima_prueba, c.ultima_prueba_ok, c.ultima_prueba_detalle
  FROM ConfiguracionCorreo c LEFT JOIN Usuarios u ON u.id = c.actualizado_por
  WHERE c.id = 1`;

function legible(cifrada: string): boolean {
  try {
    descifrarSecreto(cifrada);
    return true;
  } catch {
    return false;
  }
}

export const repositorioCorreoSalienteSql: RepositorioCorreoSaliente = {
  async obtener(): Promise<CorreoGuardado | null> {
    const f = (await getDB().request().query(SELECT)).recordset[0];
    if (!f) return null;
    return {
      servidor: f.servidor, puerto: Number(f.puerto), usuario: f.usuario,
      remitenteNombre: f.remitente_nombre, remitenteCorreo: f.remitente_correo ?? null, habilitado: Boolean(f.habilitado),
      claveLegible: legible(f.clave_cifrada),
      actualizadoPor: f.actualizado_por ?? null, fechaActualizacion: f.fecha_actualizacion ?? null,
      ultimaPrueba: f.ultima_prueba ?? null, ultimaPruebaOk: f.ultima_prueba_ok ?? null, ultimaPruebaDetalle: f.ultima_prueba_detalle ?? null,
    };
  },

  async guardar(d, claveCifrada, usuarioId) {
    const request = getDB().request()
      .input('servidor', sql.VarChar(253), d.servidor)
      .input('puerto', sql.Int, d.puerto)
      .input('usuario', sql.VarChar(150), d.usuario)
      .input('nombre', sql.VarChar(100), d.remitenteNombre)
      .input('remitente', sql.VarChar(150), d.remitenteCorreo)
      .input('habilitado', sql.Bit, d.habilitado)
      .input('uid', sql.Int, usuarioId);
    // La prueba anterior era de otra cuenta o de otro servidor: deja de mostrarse
    const comunes = `servidor = @servidor, puerto = @puerto, usuario = @usuario, remitente_nombre = @nombre,
      remitente_correo = @remitente, habilitado = @habilitado, actualizado_por = @uid, fecha_actualizacion = CURRENT_TIMESTAMP,
      ultima_prueba = NULL, ultima_prueba_ok = NULL, ultima_prueba_detalle = NULL`;
    // Sin contraseña nueva se conserva la guardada: el dominio la exige si aún no hay fila. No pasa por el
    // INSERT porque PostgreSQL comprueba NOT NULL antes de resolver el conflicto
    if (claveCifrada === null) {
      await request.query(`UPDATE ConfiguracionCorreo SET ${comunes} WHERE id = 1`);
      return;
    }
    await request.input('clave', sql.VarChar(600), claveCifrada).query(`
      INSERT INTO ConfiguracionCorreo (id, servidor, puerto, usuario, clave_cifrada, remitente_nombre, remitente_correo, habilitado, actualizado_por)
      VALUES (1, @servidor, @puerto, @usuario, @clave, @nombre, @remitente, @habilitado, @uid)
      ON CONFLICT (id) DO UPDATE SET clave_cifrada = @clave, ${comunes}`);
  },

  async eliminar() {
    await getDB().request().query('DELETE FROM ConfiguracionCorreo WHERE id = 1');
  },

  async registrarPrueba(ok, detalle) {
    await getDB().request()
      .input('ok', sql.Bit, ok).input('detalle', sql.VarChar(300), detalle.slice(0, 300))
      .query('UPDATE ConfiguracionCorreo SET ultima_prueba = CURRENT_TIMESTAMP, ultima_prueba_ok = @ok, ultima_prueba_detalle = @detalle WHERE id = 1');
  },
};

/**
 * Pone en memoria la cuenta guardada (al arrancar y después de cada cambio). Si su contraseña
 * se cifró con una clave anterior, la vuelve a cifrar con la vigente. Sin fila, deshabilitada o
 * ilegible, rigen las variables SMTP_* del servidor.
 */
export async function cargarCorreoSaliente(): Promise<void> {
  try {
    const f = (await getDB().request().query('SELECT servidor, puerto, usuario, clave_cifrada, remitente_nombre, remitente_correo, habilitado FROM ConfiguracionCorreo WHERE id = 1')).recordset[0];
    if (!f || !f.habilitado) {
      fijarCuentaGuardada(null);
      return;
    }
    const vigente = secretoConClaveVigente(f.clave_cifrada);
    if (vigente !== f.clave_cifrada) {
      await getDB().request().input('clave', sql.VarChar(600), vigente).query('UPDATE ConfiguracionCorreo SET clave_cifrada = @clave WHERE id = 1');
    }
    fijarCuentaGuardada({
      servidor: f.servidor, puerto: Number(f.puerto), usuario: f.usuario, clave: descifrarSecreto(vigente),
      remitenteNombre: f.remitente_nombre, remitenteCorreo: f.remitente_correo || f.usuario, origen: 'sistema',
    });
  } catch (e: any) {
    fijarCuentaGuardada(null);
    console.warn(`[EMAIL] Correo saliente de Configuración no disponible (${e.message}); rigen las variables SMTP_*.`);
  }
}
