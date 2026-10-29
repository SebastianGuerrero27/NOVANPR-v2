# Evidencia conservada en lista blanca y lista negra

La gestión de permisos y las dos listas muestran una celda para el vehículo y otra para el recorte real de la placa. Cada una pasa de pendiente a ingresado cuando se conserva su foto, cambia a verde y muestra la fecha del paso. Un vehículo sin recorte mantiene la placa pendiente. Las fotos se amplían con rueda del ratón, botones de zoom y arrastre, tanto en la tabla como al editar el registro.

El backend conserva la primera foto disponible por columna de una entrada procesada cuya matrícula coincide exactamente con la del registro. Una coincidencia aproximada de la lista negra no aporta evidencia a otra placa. Las lecturas pendientes del segundo OCR, desconocidas o rechazadas no se utilizan sin confirmación del personal. La evidencia confirma una captura histórica; la decisión de acceso mantiene sus reglas de vigencia y horario.

Las imágenes se copian a archivos propios de cada registro y sus rutas y fechas se guardan en `listablanca` y `listanegra`. Eliminar el acceso o sus fotos originales no elimina estas copias. Las detecciones posteriores completan la foto que falte, sin reemplazar la primera. Editar el registro para asignar otra matrícula reinicia sus celdas para evitar presentar fotos de otro vehículo.

El destino de las copias es independiente de la carpeta del motor. En Docker Compose se utiliza `EVIDENCIA_LISTAS_DIR=/app/evidencia-listas` y el volumen persistente `listas_evidencia`, propiedad del usuario `node`. Así el backend puede guardar evidencia aunque `/app/media` sólo sea legible. En Kubernetes se usa `/app/media/listas` dentro del PVC con `fsGroup: 1000`. En ejecución local sin esa variable se usa `media-listas`, excluido del repositorio.

La migración aditiva e idempotente `db/postgresql/migracion_evidencias_listas.sql` se ejecuta al iniciar el backend. En segundo plano se recupera evidencia histórica disponible por coincidencia exacta, en orden de ingreso. Si un archivo original ya no existe, la celda permanece pendiente hasta una nueva captura.

Las consultas externas de placa y cédula están retiradas; sus rutas antiguas responden 410 sin cargar conectores externos. Todos los datos se pueden llenar manualmente. La búsqueda en listas y en el historial es local y no consume créditos.

Para publicar los cambios en la instalación local existente:

```powershell
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml build backend frontend
docker compose -p anpr -f docker-compose.yml -f docker-compose.produccion-local.yml up -d --no-deps --wait --wait-timeout 180 backend frontend
```

Se verifica con pruebas de captura independiente, no sustitución, recorte tardío, coincidencia exacta, archivos ausentes, conservación tras eliminar originales, consultas retiradas y zoom. El resultado de las verificaciones del despliegue está en `docs/resultados/evidencias_listas_2026-10-28.json`.
