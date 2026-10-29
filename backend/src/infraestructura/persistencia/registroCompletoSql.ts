import { DATOS_AUSENTES_REGISTRO } from '../../dominio/registroCompleto';

const ausentes = DATOS_AUSENTES_REGISTRO.map(v => `'${v}'`).join(', ');
const dato = (campo: string) => `CASE WHEN LOWER(BTRIM(${campo})) IN (${ausentes}) THEN NULL ELSE BTRIM(${campo}) END`;
/** EXISTS permite reutilizar la regla también en COUNT y eliminación sin depender de joins externos. */
export const DATOS_INGRESO_COMPLETOS_SQL = `(
  COALESCE(d.tipo_movimiento, 'ingreso') = 'ingreso'
  AND d.fecha_hora_ingreso IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM DeteccionVehiculo registro
    LEFT JOIN ListaBlanca permiso ON permiso.id = registro.vehiculo_autorizado_id
    WHERE registro.id = d.id
      AND COALESCE(${dato('registro.persona_ingreso')}, ${dato('permiso.propietario')}) IS NOT NULL
      AND COALESCE(${dato('registro.placa_validada')}, ${dato('registro.placa_reconocida')}) IS NOT NULL
      AND COALESCE(${dato('registro.tipo_vehiculo')}, ${dato('permiso.tipo_vehiculo')}, ${dato('registro.vehiculo_tipo')}) IS NOT NULL
      AND COALESCE(${dato('registro.vehiculo_marca')}, ${dato('permiso.marca')}) IS NOT NULL
      AND COALESCE(${dato('registro.motivo_ingreso')}, ${dato('permiso.motivo_ingreso')}) IS NOT NULL
  )
)`;
export const REGISTRO_COMPLETO_SQL = `(${DATOS_INGRESO_COMPLETOS_SQL}
  AND d.fecha_hora_salida IS NOT NULL AND d.fecha_hora_salida >= d.fecha_hora_ingreso
)`;
