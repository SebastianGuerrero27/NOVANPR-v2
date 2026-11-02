import type { NextFunction, Request, Response } from 'express';
import { ErrorAplicacion, type Actor, type TipoError } from '../../aplicacion/comun';
import { esIdValido } from '../../dominio/validacion';
import { ipDe } from './peticion';

/**
 * Puente entre HTTP y los casos de uso: obtiene el actor de la sesión, valida los parámetros
 * de ruta y traduce los errores de aplicación a códigos de estado. Un error no previsto se
 * registra en el log y se responde 500 sin exponer detalles internos (OWASP ASVS V7.4).
 */

const ESTADO: Record<TipoError, number> = {
  validacion: 400, no_encontrado: 404, conflicto: 409, prohibido: 403, limite: 429, no_disponible: 503,
};

export function actorDe(req: Request): Actor {
  const u = req.user!;
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, ip: ipDe(req) };
}

/** Id numérico de la ruta; si no es válido responde 400 y devuelve null. */
export function idDe(req: Request, res: Response, parametro = 'id'): number | null {
  const valor = req.params[parametro];
  if (!esIdValido(valor)) {
    res.status(400).json({ error: 'Identificador inválido.' });
    return null;
  }
  return Number(valor);
}

/**
 * Envuelve un controlador asíncrono: los ErrorAplicacion se responden con su código y
 * mensaje; el resto, con 500 y el mensaje genérico indicado.
 */
export function controlador(contexto: string, mensaje500: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (e instanceof ErrorAplicacion) {
        if (!res.headersSent) res.status(ESTADO[e.tipo]).json({ error: e.message });
        return;
      }
      console.error(`[${contexto}]`, e?.message ?? e);
      if (!res.headersSent) res.status(500).json({ error: mensaje500 });
      // Falla a mitad de una descarga: se corta la conexión para que no parezca un archivo completo
      else res.destroy();
    }
  };
}

/** Escribe un trozo de una descarga respetando el ritmo del cliente; false si ya se desconectó. */
export function escribirRespuesta(res: Response, texto: string): Promise<boolean> {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  if (res.write(texto)) return Promise.resolve(true);
  return new Promise(resolve => {
    const listo = (valor: boolean) => { res.off('drain', sigue); res.off('close', corta); resolve(valor); };
    const sigue = () => listo(true);
    const corta = () => listo(false);
    res.once('drain', sigue);
    res.once('close', corta);
  });
}

/** Tope de tareas pesadas simultáneas de esta instancia (exportaciones): las demás reciben 429. */
export function limitarSimultaneas(maximo: number, mensaje: string) {
  let enCurso = 0;
  return (_req: Request, res: Response, next: NextFunction) => {
    if (enCurso >= maximo) return res.status(429).json({ error: mensaje });
    enCurso++;
    res.once('close', () => { enCurso--; });
    next();
  };
}
