-- Evidencia independiente del historial de detecciones. Idempotente.
ALTER TABLE listablanca
  ADD COLUMN IF NOT EXISTS ruta_evidencia_vehiculo varchar(500),
  ADD COLUMN IF NOT EXISTS ruta_evidencia_placa varchar(500),
  ADD COLUMN IF NOT EXISTS fecha_evidencia_vehiculo timestamp,
  ADD COLUMN IF NOT EXISTS fecha_evidencia_placa timestamp;
ALTER TABLE listanegra
  ADD COLUMN IF NOT EXISTS ruta_evidencia_vehiculo varchar(500),
  ADD COLUMN IF NOT EXISTS ruta_evidencia_placa varchar(500),
  ADD COLUMN IF NOT EXISTS fecha_evidencia_vehiculo timestamp,
  ADD COLUMN IF NOT EXISTS fecha_evidencia_placa timestamp;
