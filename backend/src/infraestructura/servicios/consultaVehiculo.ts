import { ErrorProveedorVehiculo, type DatosConsultaVehiculo, type EstadoConsultaVehiculo, type ProveedorConsultaVehiculo } from '../../aplicacion/consultaVehiculo';
import { normalizarPlaca } from '../../dominio/validacion';

/** Contrato documentado: https://www.ecuadorapi.com/documentacion/placa . Sin sondeos externos ni reintentos con costo. */
export class ProveedorEcuadorApi implements ProveedorConsultaVehiculo {
  private suspendidoHasta = 0;
  private mensajeSuspension: string | null = null;
  constructor(private readonly clave = process.env.ECUADORAPI_KEY ?? '', private readonly solicitar: typeof fetch = fetch,
    private readonly ahora: () => number = Date.now) {}
  habilitado() { return Boolean(this.clave.trim()); }
  estado(): EstadoConsultaVehiculo {
    const habilitado = this.habilitado();
    const segundos = Math.max(0, Math.ceil((this.suspendidoHasta - this.ahora()) / 1000));
    return {
      capacidad_local: true, estado_proveedor: segundos > 0 ? 'error_reciente' : 'sin_comprobar',
      habilitado, puede_consultar: habilitado && segundos === 0, reintentar_en_s: segundos,
      mensaje: !habilitado ? 'La consulta externa de vehículos no está configurada. Puede completar los datos manualmente.'
        : segundos > 0 ? this.mensajeSuspension : null,
    };
  }
  private suspender(mensaje: string, segundos = 60, codigo = 'temporal'): never {
    this.suspendidoHasta = this.ahora() + Math.max(30, Math.min(segundos, 900)) * 1000;
    this.mensajeSuspension = mensaje;
    throw new ErrorProveedorVehiculo(mensaje, codigo);
  }
  async consultar(placa: string): Promise<DatosConsultaVehiculo | null> {
    const estado = this.estado();
    if (!estado.puede_consultar) throw new ErrorProveedorVehiculo(estado.mensaje || 'La consulta externa no está disponible.');
    let respuesta: Response;
    try {
      respuesta = await this.solicitar(`https://api.ecuadorapi.com/api/v1/placas/${encodeURIComponent(placa)}`, {
        headers: { Authorization: `Bearer ${this.clave}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000), redirect: 'error',
      });
    } catch {
      return this.suspender('El proveedor de datos vehiculares no respondió. Las consultas automáticas se pausaron; puede completar los datos manualmente.', 60, 'sin_respuesta');
    }
    if (respuesta.status === 404) return null;
    if (!respuesta.ok) {
      const retryAfter = Number(respuesta.headers?.get('Retry-After'));
      const espera = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
      const codigo = `http_${respuesta.status}`;
      if (respuesta.status === 401 || respuesta.status === 403) return this.suspender('El proveedor rechazó la autenticación. El administrador debe revisar la clave y la cuenta. Puede completar los datos manualmente.', 300, codigo);
      if (respuesta.status === 402) return this.suspender('La cuenta del proveedor no tiene saldo disponible. Puede completar los datos manualmente.', 300, codigo);
      if (respuesta.status === 429) return this.suspender('El proveedor alcanzó su límite de consultas. Las consultas automáticas se pausaron; puede completar los datos manualmente.', espera, codigo);
      return this.suspender('El proveedor no pudo confirmar los datos del vehículo. Las consultas automáticas se pausaron; puede completar los datos manualmente.', espera, codigo);
    }
    const cuerpo = await respuesta.json().catch(() => null) as { data?: Record<string, unknown>; error?: unknown } | null;
    const dato = cuerpo?.data;
    if (!cuerpo || cuerpo.error || !dato || typeof dato.plate !== 'string' || normalizarPlaca(dato.plate) !== placa) return this.suspender('Respuesta incompatible con la placa consultada. Puede completar los datos manualmente.', 60, 'respuesta_incompatible');
    const texto = (v: unknown) => typeof v === 'string' && v.trim() && v.trim().length <= 50 ? v.trim() : null;
    const resultado = { placa, marca: texto(dato.brand), modelo: texto(dato.model), color: texto(dato.color)?.toLowerCase() ?? null, tipo_vehiculo: texto(dato.vehicle_class) };
    if (!resultado.marca && !resultado.modelo && !resultado.color && !resultado.tipo_vehiculo) return null;
    return resultado;
  }
}
