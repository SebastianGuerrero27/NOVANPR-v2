# Renombre de la tabla de lista blanca · 29 de octubre de 2026

La tabla PostgreSQL `public.vehiculosautorizados` se renombró a **`public.listablanca`**. En las consultas del backend se escribe `ListaBlanca`, que PostgreSQL interpreta en minúsculas al no usar comillas. La base continúa siendo `ANPR_ECU911` y el esquema continúa siendo `public`.

La migración usa `ALTER TABLE … RENAME TO`, sin copiar ni borrar registros. Se conservaron los cuatro registros existentes, su contenido, columnas, OID, claves foráneas, índices y secuencia de identidad. Los nombres históricos de índices, restricciones, secuencia y la columna `vehiculo_autorizado_id` se mantienen para limitar el cambio al nombre de la tabla. Las rutas y fotos guardadas tampoco se modificaron.

El backend ejecuta `db/postgresql/migracion_renombrar_lista_blanca.sql` antes de cargar el esquema. Una instalación nueva crea `listablanca`; una anterior renombra la tabla y un reinicio no vuelve a migrarla. Si existen ambas relaciones, se detiene sin combinar ni eliminar datos. El esquema independiente también rechaza crear una tabla vacía paralela mientras exista la anterior.

Los repositorios de listas, detecciones, solicitudes, notificaciones, panel, reportes y coincidencia de placas utilizan el nuevo nombre. El frontend mantiene las rutas `/api/vehiculos-autorizados` y `/api/vehiculos-autorizados/mis-permisos`: esos identificadores son contratos HTTP, no nombres de tablas. No se cambió la lógica de permisos, acceso ni formularios.

Los scripts antiguos de SQL Server conservan sus nombres históricos y no se ejecutan en la instalación PostgreSQL. No deben utilizarse para reconstruir este esquema.

## Verificación y respaldo

- Respaldo completo previo con `pg_dump`, guardado fuera del repositorio en `C:/Users/ASUS/.codex/backups/anpr/2026-10-29/`. No se incluyó su contenido en los informes.
- [Prueba SQL aislada](resultados/renombre_lista_blanca_aislado_2026-10-29.json): conservación de dependencias, escritura posterior y secuencia, idempotencia, rechazo del conflicto, protección del esquema e instalación nueva. Sus esquemas de prueba se deshicieron mediante rollback.
- [Comprobación posterior real](resultados/renombre_lista_blanca_2026-10-29.json): mismo OID y huellas de filas/columnas antes y después, mismas claves foráneas e índices, tabla anterior ausente y rutas de listas, detecciones, panel y solicitudes con HTTP 200.
- Compilación TypeScript aprobada; tres pruebas de contrato de migración, 67 pruebas focales del backend y dos de compatibilidad del frontend aprobadas.
- La suite general de integración obtuvo 61/66. Los cinco fallos corresponden a expectativas anteriores de permisos de Guardia y a una ruta de reportes; esas reglas no se modificaron para ocultar los fallos. Se registran por separado del resultado del renombre.

El backend se reconstruyó y desplegó en el proyecto Compose `anpr`; frontend, motor y PostgreSQL conservaron sus instancias. Los cuatro contenedores con healthcheck terminaron saludables.

## Consulta administrativa

```sql
SELECT * FROM public.listablanca;
```

Para instalaciones existentes, la migración debe preceder al esquema. No se debe crear manualmente una tabla nueva y copiar sus datos: se perdería la garantía de conservar el mismo objeto y sus dependencias.
