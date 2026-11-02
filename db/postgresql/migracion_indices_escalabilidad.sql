-- Índices hallados con las pruebas de carga (backend/scripts/carga, 1 millón de pasos).
-- Idempotente; se ejecuta en cada arranque y solo la primera vez construye algo. Sin límite de tiempo
-- de sentencia: en una base grande la construcción puede superar los 30 s del pool.
BEGIN;
SET LOCAL statement_timeout = 0;

-- Claves foráneas de los pasos. Sin ellas, «ingresos por permiso» de las listas recorría la tabla
-- completa por cada registro (lista blanca: 30 s y error) y borrar un permiso o usuario también.
CREATE INDEX IF NOT EXISTS ix_deteccion_autorizado ON deteccionvehiculo (vehiculo_autorizado_id) WHERE vehiculo_autorizado_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_deteccion_alerta ON deteccionvehiculo (alerta_id) WHERE alerta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_deteccion_validador ON deteccionvehiculo (usuario_validador_id) WHERE usuario_validador_id IS NOT NULL;

-- Consulta de una placa (PLACA_D de deteccionesSql.ts): misma expresión, con sus últimos pasos primero
CREATE INDEX IF NOT EXISTS ix_deteccion_placa_normalizada ON deteccionvehiculo ((REPLACE(COALESCE(placa_validada, placa_reconocida, ''), '-', '')), fecha_hora_ingreso DESC);

-- Cola de revisión del panel: solo lo que falta revisar
CREATE INDEX IF NOT EXISTS ix_deteccion_cola ON deteccionvehiculo (fecha_hora_ingreso) WHERE estado_validacion = 'pendiente_revision' AND validado_manualmente = FALSE;

COMMIT;
