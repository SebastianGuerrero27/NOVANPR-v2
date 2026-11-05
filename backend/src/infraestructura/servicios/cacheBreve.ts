/**
 * Memoria breve de consultas pesadas que muchas sesiones piden a la vez (cada paso vehicular hace
 * recargar el panel de todos los operadores). Las peticiones simultáneas comparten una sola
 * consulta y el resultado se reutiliza durante `vigenciaMs`.
 *
 * Con `servirVencidoMs`, un valor vencido se entrega al instante mientras se recalcula en segundo
 * plano: sirve para totales históricos, que tardan segundos y cambian poco. Un error nunca se
 * guarda: la siguiente petición vuelve a intentarlo.
 */
export interface OpcionesCache { vigenciaMs: number; servirVencidoMs?: number }

export interface FuncionConCache<A extends unknown[], T> {
  (...args: A): Promise<T>;
  olvidar(): void;
}

export function conCacheBreve<A extends unknown[], T>(calcular: (...args: A) => Promise<T>, opciones: OpcionesCache): FuncionConCache<A, T> {
  let valor: { dato: T; t: number } | null = null;
  let enCurso: Promise<T> | null = null;
  let generacion = 0;

  const refrescar = (args: A): Promise<T> => {
    if (enCurso) return enCurso;
    const propia = generacion;
    const consulta = calcular(...args)
      .then(dato => {
        if (propia === generacion) valor = { dato, t: Date.now() };
        return dato;
      })
      .finally(() => { if (enCurso === consulta) enCurso = null; });
    enCurso = consulta;
    return consulta;
  };

  const funcion = (async (...args: A) => {
    const edad = valor ? Date.now() - valor.t : Infinity;
    if (valor && edad < opciones.vigenciaMs) return valor.dato;
    if (valor && edad < opciones.vigenciaMs + (opciones.servirVencidoMs ?? 0)) {
      // Quien pidió no espera; un fallo del recálculo se reintenta en la siguiente petición
      refrescar(args).catch(() => undefined);
      return valor.dato;
    }
    return refrescar(args);
  }) as FuncionConCache<A, T>;

  funcion.olvidar = () => { generacion++; valor = null; enCurso = null; };
  return funcion;
}

/** Igual que conCacheBreve, con una memoria por clave (p. ej. por combinación de filtros) y un tope de claves. */
export function conCachePorClave<A extends unknown[], T>(
  calcular: (...args: A) => Promise<T>, clave: (...args: A) => string, opciones: OpcionesCache, maxClaves = 100,
): (...args: A) => Promise<T> {
  const memorias = new Map<string, FuncionConCache<A, T>>();
  return (...args: A) => {
    const k = clave(...args);
    let memoria = memorias.get(k);
    if (!memoria) {
      // Se descarta la clave más antigua: los filtros los elige el usuario y no deben crecer sin tope
      if (memorias.size >= maxClaves) memorias.delete(memorias.keys().next().value as string);
      memoria = conCacheBreve(calcular, opciones);
      memorias.set(k, memoria);
    }
    return memoria(...args);
  };
}
