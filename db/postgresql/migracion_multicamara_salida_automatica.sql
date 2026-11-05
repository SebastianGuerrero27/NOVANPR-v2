-- Varias cámaras con análisis ANPR y salida automática por la cámara de salida. Idempotente.
BEGIN;

-- Una cámara puede quedar solo para ver video, sin gastar CPU del motor
ALTER TABLE camaras ADD COLUMN IF NOT EXISTS analisis_anpr boolean NOT NULL DEFAULT TRUE;

-- Paso de la cámara de salida que cerró este ingreso. Permite reabrirlo si esa lectura se corrige o se
-- elimina, y distinguir una salida automática de una registrada a mano.
ALTER TABLE deteccionvehiculo ADD COLUMN IF NOT EXISTS salida_deteccion_id integer
  REFERENCES deteccionvehiculo(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_deteccion_salida_automatica ON deteccionvehiculo (salida_deteccion_id)
  WHERE salida_deteccion_id IS NOT NULL;

-- El motor ya no procesa una sola cámara elegida
DELETE FROM configuracionsistema WHERE clave = 'camara_motor_id';

COMMIT;
