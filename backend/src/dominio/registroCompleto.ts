/** Campos de la hoja de registros; no exige atributos opcionales como modelo o color. */
export const DATOS_AUSENTES_REGISTRO = ['', '-', '—', 'desconocido', 'sin clasificar', 'sin identificar', 'unknown', 'n/a', 'sin placa'] as const;
export function datoRegistro(...valores: unknown[]): string | null {
  for (const valor of valores) {
    if (typeof valor !== 'string') continue;
    const texto = valor.trim();
    if (!(DATOS_AUSENTES_REGISTRO as readonly string[]).includes(texto.toLowerCase())) return texto;
  }
  return null;
}
export function datosRegistro(d: Record<string, any>) {
  return {
    nombre: datoRegistro(d.persona_ingreso, d.propietario),
    placa: datoRegistro(d.placa_validada, d.placa_reconocida),
    tipo: datoRegistro(d.tipo_vehiculo, d.autorizado_tipo, d.vehiculo_tipo),
    marca: datoRegistro(d.vehiculo_marca, d.autorizado_marca),
    // El motivo del paso o, si está vacío, el del permiso de la lista blanca
    motivo: datoRegistro(d.motivo_ingreso, d.autorizado_motivo),
  };
}
export function faltantesIngreso(d: Record<string, any>): string[] {
  const campos = datosRegistro(d);
  const etiquetas = { nombre: 'Nombre', placa: 'Placa', tipo: 'Tipo de vehículo', marca: 'Marca', motivo: 'Motivo' };
  const faltantes = (Object.keys(campos) as (keyof typeof campos)[]).filter(k => !campos[k]).map(k => etiquetas[k]);
  const ingreso = d.fecha_hora_ingreso ? new Date(d.fecha_hora_ingreso).getTime() : NaN;
  if (!Number.isFinite(ingreso)) faltantes.push('Fecha de ingreso');
  return faltantes;
}
export function faltantesRegistro(d: Record<string, any>): string[] {
  const faltantes = faltantesIngreso(d);
  const ingreso = d.fecha_hora_ingreso ? new Date(d.fecha_hora_ingreso).getTime() : NaN;
  const salida = d.fecha_hora_salida ? new Date(d.fecha_hora_salida).getTime() : NaN;
  if (!Number.isFinite(salida)) faltantes.push('Salida');
  else if (salida < ingreso) faltantes.push('Salida posterior al ingreso');
  return faltantes;
}
