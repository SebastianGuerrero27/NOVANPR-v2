/**
 * Versión del frontend publicada. Cada compilación de producción nombra su paquete principal
 * con un hash (assets/index-<hash>.js) y index.html se sirve sin caché: si el que publica el
 * servidor no es el que cargó esta pestaña, se instaló una versión nueva. Una pestaña abierta
 * antes de actualizar sigue con el código anterior en memoria hasta que se recarga.
 */

const RE_PAQUETE = /\/assets\/index-[\w-]+\.js/;

/** Paquete principal con que se cargó esta pestaña; null en desarrollo (Vite sirve /src/main.tsx). */
export function versionCargada(): string | null {
  for (const s of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))) {
    const m = RE_PAQUETE.exec(s.src);
    if (m) return m[0];
  }
  return null;
}

/** Paquete principal que publica ahora el servidor; null si no se pudo consultar. */
export async function versionPublicada(): Promise<string | null> {
  try {
    const r = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!r.ok) return null;
    return RE_PAQUETE.exec(await r.text())?.[0] ?? null;
  } catch {
    return null;
  }
}
