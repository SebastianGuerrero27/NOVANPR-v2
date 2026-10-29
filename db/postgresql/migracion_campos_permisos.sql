-- Ampliación compatible: no elimina columnas, registros ni permisos existentes.
ALTER TABLE vehiculosautorizados
  ADD COLUMN IF NOT EXISTS cedula varchar(10),
  ADD COLUMN IF NOT EXISTS institucion varchar(150),
  ADD COLUMN IF NOT EXISTS cargo varchar(150);
ALTER TABLE vehiculosautorizados ALTER COLUMN placa DROP NOT NULL;
ALTER TABLE listanegra ALTER COLUMN placa DROP NOT NULL;
ALTER TABLE deteccionvehiculo ALTER COLUMN placa_validada DROP NOT NULL;
ALTER TABLE solicitudesacceso
  ADD COLUMN IF NOT EXISTS cedula varchar(10),
  ADD COLUMN IF NOT EXISTS institucion varchar(150),
  ADD COLUMN IF NOT EXISTS cargo varchar(150),
  ADD COLUMN IF NOT EXISTS observaciones varchar(255);
-- Los formularios y la validación del backend admiten tipos personalizados de hasta 50 caracteres.
ALTER TABLE deteccionvehiculo ALTER COLUMN vehiculo_tipo TYPE varchar(50);
-- Datos capturados en garita; su almacenamiento no concede un permiso de lista blanca.
ALTER TABLE deteccionvehiculo ADD COLUMN IF NOT EXISTS datos_permiso jsonb;
-- Una cédula identifica a una sola persona con permiso activo. Los permisos sin cédula
-- siguen permitidos y los registros retirados pueden conservar su historial.
CREATE UNIQUE INDEX IF NOT EXISTS ux_vehiculosautorizados_cedula_activa
  ON vehiculosautorizados (cedula)
  WHERE activo = TRUE AND cedula IS NOT NULL;
