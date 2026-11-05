-- Datos FICTICIOS para las pruebas de carga. Placas, nombres y cédulas salen de generate_series:
-- ninguno es real. Uso: psql -v filas=1000000 -v dias=365 -f sembrar.sql
\set ON_ERROR_STOP on

INSERT INTO usuarios (email, nombre_completo, password_hash, rol_id, estado, email_verificado)
SELECT 'carga.admin@prueba.invalid', 'Admin de carga', '$2a$12$' || repeat('x', 53), r.id, 'activo', true
FROM roles r WHERE r.codigo = 'ADMIN'
ON CONFLICT (email) DO NOTHING;

INSERT INTO camaras (nombre, ip, rtsp_url, ubicacion, activa)
SELECT 'Cámara ' || g, '10.0.0.' || g, 'rtsp://10.0.0.' || g || '/ficticia', 'Garita ' || g, true
FROM generate_series(1, 4) g
WHERE NOT EXISTS (SELECT 1 FROM camaras);

-- Placa ficticia: el prefijo ZZ no corresponde a ninguna provincia
CREATE FUNCTION pg_temp.placa(n bigint) RETURNS text LANGUAGE sql IMMUTABLE AS
  'SELECT ''ZZ'' || chr(65 + (n % 26)::int) || ''-'' || lpad((n % 10000)::text, 4, ''0'')';

INSERT INTO listablanca (placa, propietario, cedula, departamento, tipo_vehiculo, marca, modelo, categoria, activo,
                         registrado_por, fecha_vencimiento, motivo_ingreso)
SELECT pg_temp.placa(g), 'Titular Ficticio ' || g, (7000000000 + g)::text, 'Departamento ' || (g % 12),
       'Automóvil', 'Marca' || (g % 20), 'Modelo' || (g % 50), 'FUNCIONARIO', true,
       (SELECT id FROM usuarios WHERE email = 'carga.admin@prueba.invalid'),
       CURRENT_DATE + (g % 400 - 30)::int, 'Ingreso de prueba'
FROM generate_series(1, 2000) g
ON CONFLICT (placa) DO NOTHING;

INSERT INTO listanegra (placa, motivo, nivel_alerta, activo)
SELECT pg_temp.placa(5000 + g), 'Motivo ficticio ' || g, 'ALTA', true
FROM generate_series(1, 200) g
ON CONFLICT (placa) DO NOTHING;

-- Pasos repartidos en :dias días, con la mezcla de estados de una garita
INSERT INTO deteccionvehiculo (
  confianza_deteccion, confianza_ocr, tracking_id, fuente, tipo_movimiento, estado_validacion, camara_id,
  vehiculo_autorizado_id, estado_procesamiento, ruta_imagen_ingreso, ruta_imagen_placa, fecha_hora_ingreso,
  fecha_hora_salida, placa_reconocida, fecha_hora_procesamiento, tipo_vehiculo, vehiculo_marca, vehiculo_modelo,
  persona_ingreso, motivo_ingreso, cedula_ingreso)
SELECT 0.8, 0.9, (g % 5000)::int, 'rtsp',
       CASE WHEN g % 10 = 0 THEN 'salida' ELSE 'ingreso' END,
       (ARRAY['autorizado','autorizado','autorizado','no_reconocido','no_reconocido','pendiente_revision','alerta'])[1 + (g % 7)::int],
       c.base + (g % 4)::int,
       CASE WHEN g % 7 < 3 THEN l.base + (g % 2000)::int END,
       CASE WHEN g % 50 = 0 THEN 'no_legible' ELSE 'procesado' END,
       'ingreso_' || g || '.jpg', 'placa_' || g || '.jpg',
       t.ingreso,
       CASE WHEN g % 10 <> 0 AND g % 3 <> 0 THEN t.ingreso + interval '45 minutes' END,
       pg_temp.placa(g), t.ingreso + interval '2 seconds', 'Automóvil',
       'Marca' || (g % 20), 'Modelo' || (g % 50),
       CASE WHEN g % 2 = 0 THEN 'Persona Ficticia ' || (g % 3000) END,
       CASE WHEN g % 2 = 0 THEN 'Motivo de prueba ' || (g % 40) END,
       CASE WHEN g % 2 = 0 THEN lpad((g % 3000)::text, 10, '8') END
FROM generate_series(1, :filas) g
CROSS JOIN (SELECT min(id) AS base FROM camaras) c
CROSS JOIN (SELECT min(id) AS base FROM listablanca) l
CROSS JOIN LATERAL (SELECT CURRENT_TIMESTAMP - (:dias * interval '1 day') * (g::float8 / :filas) AS ingreso) t;

-- Notificaciones y auditoría, en la proporción que dejan los pasos
INSERT INTO notificaciones (tipo, severidad, titulo, mensaje, fecha_creacion, fecha_ultima, requiere_ack, fecha_atencion)
SELECT 'prueba', 'media', 'Aviso ' || g, 'Mensaje ficticio ' || g,
       CURRENT_TIMESTAMP - (:dias * interval '1 day') * (g::float8 / (:filas / 10)),
       CURRENT_TIMESTAMP - (:dias * interval '1 day') * (g::float8 / (:filas / 10)),
       g % 20 = 0, CASE WHEN g % 40 = 0 THEN CURRENT_TIMESTAMP END
FROM generate_series(1, :filas / 10) g;

INSERT INTO notificacionusuario (notificacion_id, usuario_id, fecha_lectura)
SELECT n.id, (SELECT id FROM usuarios WHERE email = 'carga.admin@prueba.invalid'),
       CASE WHEN n.id % 5 <> 0 THEN CURRENT_TIMESTAMP END
FROM notificaciones n
ON CONFLICT DO NOTHING;

INSERT INTO auditoriaoperaciones (fecha, usuario_email, accion, entidad, entidad_id, detalle, ip)
SELECT CURRENT_TIMESTAMP - (:dias * interval '1 day') * (g::float8 / (:filas / 5)),
       'carga.admin@prueba.invalid', 'VALIDAR', 'deteccion', g, 'Detalle ficticio ' || g, '10.0.0.1'
FROM generate_series(1, :filas / 5) g;

ANALYZE;
SELECT (SELECT count(*) FROM deteccionvehiculo) AS pasos, (SELECT count(*) FROM notificaciones) AS avisos,
       (SELECT count(*) FROM auditoriaoperaciones) AS auditoria,
       pg_size_pretty(pg_database_size(current_database())) AS tamano;
