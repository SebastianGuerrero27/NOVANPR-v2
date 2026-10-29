import type { DatosConsultaPersona, ProveedorConsultaPersona } from '../../aplicacion/consultaPersona';
import { validarTexto } from '../../dominio/validacion';
/** Contrato: https://www.ecuadorapi.com/guias/api-cedula-ecuador */
export class ProveedorNombresEcuadorApi implements ProveedorConsultaPersona {
  constructor(private readonly clave = process.env.ECUADORAPI_KEY ?? '', private readonly solicitar: typeof fetch = fetch) {}
  habilitado() { return Boolean(this.clave.trim()); }
  async consultar(cedula: string): Promise<DatosConsultaPersona | null> {
    const respuesta = await this.solicitar(`https://api.ecuadorapi.com/api/v1/cedulas/${encodeURIComponent(cedula)}/nombres`, {
      headers: { Authorization: `Bearer ${this.clave}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    if (respuesta.status === 404) return null;
    if (!respuesta.ok) throw new Error('Proveedor no disponible.');
    const cuerpo = await respuesta.json() as { data?: { id?: unknown; full_name?: unknown }; error?: unknown };
    if (cuerpo.error || !cuerpo.data || cuerpo.data.id !== cedula) throw new Error('Identificación de respuesta incompatible.');
    if (cuerpo.data.full_name == null) return null;
    const nombre = validarTexto(cuerpo.data.full_name, { etiqueta: 'Nombre', tipo: 'nombre', min: 3, max: 150, requerido: true });
    if (!nombre.ok) throw new Error('Nombre de respuesta incompatible.');
    return { cedula, nombre: nombre.valor! };
  }
}

/** Contrato publicado por Socket Studio: respuesta { cedula, nombres, status }. */
export class ProveedorNombresSocketStudio implements ProveedorConsultaPersona {
  constructor(private readonly token = process.env.SOCKET_STUDIO_TOKEN ?? '',
    private readonly solicitar: typeof fetch = fetch) {}
  habilitado() { return Boolean(this.token.trim()); }
  async consultar(cedula: string): Promise<DatosConsultaPersona | null> {
    const respuesta = await this.solicitar(`https://api.socketsudio.com/v1/cedula/${encodeURIComponent(cedula)}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    if (respuesta.status === 404) return null;
    if (!respuesta.ok) throw new Error('Proveedor no disponible.');
    const cuerpo = await respuesta.json() as { status?: number; cedula?: unknown; nombres?: unknown; nombre?: unknown };
    if ((cuerpo.status !== undefined && cuerpo.status !== 200) || cuerpo.cedula !== cedula) throw new Error('Identificación de respuesta incompatible.');
    const texto = cuerpo.nombres ?? cuerpo.nombre;
    if (texto == null) return null;
    const nombre = validarTexto(texto, { etiqueta: 'Nombre', tipo: 'nombre', min: 3, max: 150, requerido: true });
    if (!nombre.ok) throw new Error('Nombre de respuesta incompatible.');
    return { cedula, nombre: nombre.valor! };
  }
}
