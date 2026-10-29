-- El formulario «Autorizar ingreso» se guardaba en DeteccionVehiculo.datos_permiso (JSON). Desde el
-- 2026-10-28 cada campo tiene su columna (esquema.sql): los pasos anteriores se copian una vez y la
-- columna JSON se elimina. Idempotente: sin datos_permiso no hace nada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'deteccionvehiculo' AND column_name = 'datos_permiso') THEN
    UPDATE deteccionvehiculo SET
      -- Clave presente con null = campo vaciado a propósito ('')
      cedula_ingreso = CASE WHEN datos_permiso ? 'cedula' THEN LEFT(COALESCE(datos_permiso->>'cedula', ''), 10) ELSE cedula_ingreso END,
      institucion_ingreso = CASE WHEN datos_permiso ? 'institucion' THEN LEFT(COALESCE(datos_permiso->>'institucion', ''), 150) ELSE institucion_ingreso END,
      cargo_ingreso = CASE WHEN datos_permiso ? 'cargo' THEN LEFT(COALESCE(datos_permiso->>'cargo', ''), 150) ELSE cargo_ingreso END,
      departamento_ingreso = CASE WHEN datos_permiso ? 'departamento' THEN LEFT(COALESCE(datos_permiso->>'departamento', ''), 100) ELSE departamento_ingreso END,
      categoria_permiso = COALESCE(categoria_permiso, LEFT(datos_permiso->>'categoria', 20)),
      observaciones_permiso = COALESCE(observaciones_permiso, LEFT(datos_permiso->>'observaciones', 255)),
      vigencia_desde = COALESCE(vigencia_desde, CASE WHEN datos_permiso->>'fecha_inicio' ~ '^\d{4}-\d{2}-\d{2}$'
        THEN (datos_permiso->>'fecha_inicio')::date END),
      vigencia_hasta = COALESCE(vigencia_hasta, CASE WHEN COALESCE(datos_permiso->>'fecha_fin', datos_permiso->>'fecha_vencimiento') ~ '^\d{4}-\d{2}-\d{2}$'
        THEN COALESCE(datos_permiso->>'fecha_fin', datos_permiso->>'fecha_vencimiento')::date END),
      horario_permiso = COALESCE(horario_permiso, CASE jsonb_typeof(datos_permiso->'horario')
        WHEN 'array' THEN LEFT((datos_permiso->'horario')::text, 600) WHEN 'string' THEN LEFT(datos_permiso->>'horario', 600) END),
      persona_ingreso = COALESCE(persona_ingreso, LEFT(datos_permiso->>'propietario', 150))
    WHERE datos_permiso IS NOT NULL;
    ALTER TABLE deteccionvehiculo DROP COLUMN datos_permiso;
  END IF;
END $$;
