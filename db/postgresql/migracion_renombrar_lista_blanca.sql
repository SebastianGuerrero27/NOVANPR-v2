-- Renombra sólo la tabla del padrón; conserva su OID, filas, columnas, referencias,
-- índices, restricciones y secuencia de identidad. La base y el esquema no cambian.
-- El bloque es atómico e idempotente y debe ejecutarse antes de esquema.sql.
DO $lista_blanca$
DECLARE
  esquema_actual name := current_schema();
  tabla_anterior regclass := to_regclass(format('%I.vehiculosautorizados', esquema_actual));
  tabla_nueva regclass := to_regclass(format('%I.listablanca', esquema_actual));
  clase_anterior "char";
  clase_nueva "char";
BEGIN
  IF tabla_anterior IS NOT NULL AND tabla_nueva IS NOT NULL THEN
    RAISE EXCEPTION 'Existen vehiculosautorizados y listablanca en el esquema %. No se renombra ni se combinan sus datos; revise ambas relaciones.', esquema_actual;
  END IF;

  IF tabla_nueva IS NOT NULL THEN
    SELECT relkind INTO clase_nueva FROM pg_class WHERE oid = tabla_nueva;
    IF clase_nueva NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'La relación %.listablanca existe, pero no es una tabla.', esquema_actual;
    END IF;
  END IF;

  IF tabla_anterior IS NOT NULL THEN
    SELECT relkind INTO clase_anterior FROM pg_class WHERE oid = tabla_anterior;
    IF clase_anterior NOT IN ('r', 'p') THEN
      RAISE EXCEPTION 'La relación %.vehiculosautorizados existe, pero no es una tabla.', esquema_actual;
    END IF;
    EXECUTE format('ALTER TABLE %I.vehiculosautorizados RENAME TO listablanca', esquema_actual);
  END IF;
END;
$lista_blanca$;
