-- Columnas y tablas que ningún código usa (revisión del 2026-10-28). Idempotente.
-- condicion_clima: nadie la llenaba; era para una exportación de evaluación que ya no existe.
ALTER TABLE deteccionvehiculo DROP COLUMN IF EXISTS condicion_clima;
-- schemamigraciones: registraba la migración única del video de prueba, retirado ese día.
DROP TABLE IF EXISTS schemamigraciones;
