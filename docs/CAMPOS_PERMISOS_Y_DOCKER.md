# Campos de permisos y actualización Docker

El alta directa usa `FormularioLista` desde Gestión de permisos, Listas, el aviso de acceso y el detalle de una detección. Solicitar acceso y aprobarlo usan los mismos componentes `CamposPersonaPermiso` y `VigenciaPermiso`. No se muestra categoría; la columna histórica se conserva por compatibilidad.

| Dato | Columna | Longitud |
|---|---|---|
| Nombres y apellidos | propietario | 150 |
| Cédula (texto; conserva ceros) | cedula | 10 dígitos si se informa |
| Institución | institucion | 150 |
| Cargo | cargo | 150 |
| Departamento o unidad | departamento | 100 |
| Tipo, marca, modelo | tipo_vehiculo, marca, modelo | 50 cada uno |
| Color | color | 30 |
| Observaciones | observaciones | 255 |
| Placa | placa | 10; formato validado por la API |
| Vigencia | fecha_inicio, fecha_vencimiento (solicitud: fecha_fin) | DATE |
| Horario | horario | JSON validado, serializado hasta 600 caracteres |

En el permiso directo solo el nombre es obligatorio y la placa puede completarse al llegar. La solicitud requiere placa y motivo (5–300 caracteres) porque se origina en un acceso concreto. La aprobación conserva los datos de persona y permite revisarlos antes de crear el permiso. Las acciones mantienen las reglas de autorización, auditoría y separación entre solicitante y aprobador.

`db/postgresql/esquema.sql` define las instalaciones nuevas. `db/postgresql/migracion_campos_permisos.sql` adapta instalaciones existentes al arrancar el backend: agrega los cuatro campos de solicitudes y amplía `deteccionvehiculo.vehiculo_tipo` de 30 a 50 caracteres. No elimina datos ni columnas. La migración se incluye en la imagen de producción junto al esquema.

## Actualizar el proyecto local existente

```powershell
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml build backend frontend
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml up -d --no-deps backend frontend
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml ps
```

Este modo conserva el proyecto `anpr`, su base de datos, las evidencias y los servicios de cámara. Solo sustituye backend/frontend: TypeScript compilado y nginx; no monta el código fuente. En futuras actualizaciones deben usarse los mismos dos archivos Compose. Para volver al modo de desarrollo puede usarse `docker compose -p anpr -f docker-compose.yml up -d --no-deps backend frontend`; las columnas añadidas siguen siendo compatibles.

Para un servidor nuevo se conserva `docker-compose.prod.yml` y su guía `INSTALAR_PRODUCCION.md`. No se debe arrancar ese proyecto separado encima de una instalación existente creyendo que comparte automáticamente el volumen de datos: tiene nombre y volúmenes propios.

La consulta de vehículos por placa sigue siendo opcional. Ambos modos de producción reciben `ECUADORAPI_KEY` del entorno privado; sin clave no se envían consultas externas.
