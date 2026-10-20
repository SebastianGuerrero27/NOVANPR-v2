# Cámara de prueba con un video y vehículos sin placa visible

## 1. Cámara de prueba con un video grabado

**Cámaras › Cargar video** (administrador) crea una cámara a partir de un video MP4, MKV o MOV
(por ejemplo, la descarga del NVR de la garita). El sistema la trata como una cámara real:

1. El backend guarda el archivo en `VIDEOS_PRUEBA_DIR` con un nombre que genera él mismo y comprueba
   la firma del archivo (no la extensión). Rechaza lo que supere `VIDEOS_PRUEBA_MAX_MB` (2048 MB por
   omisión).
2. MediaMTX (imagen `1.21.1-ffmpeg`) publica el archivo en bucle, a velocidad real y sin recodificar,
   en la ruta `cam_<id>` de la cámara. Solo se autoriza esa publicación: usuario del motor, por RTSP,
   hacia una cámara de video habilitada.
3. El motor ANPR la lee como cualquier cámara. El monitoreo en vivo la muestra por WebRTC con el HUD,
   y los pasos quedan en el historial con esa cámara.

Después de cargarla, se dibujan sus **Zonas** y se asigna al motor en **Monitoreo**. Una cámara de
video no se edita; para cambiar el video, se elimina o deshabilita y se carga otro. Si no tiene
detecciones, al eliminarla también se borra su archivo. La conectividad se comprueba en su ruta de
MediaMTX ("En línea" significa que el video se está publicando).

La función existe solo si el backend define `VIDEOS_PRUEBA_DIR`: `docker-compose.yml` (desarrollo)
la habilita y `docker-compose.prod.yml` no. Las grabaciones contienen placas (datos personales,
LOPDP), así que `services/anpr/media/videos_prueba/` y `dataset/videos_garita/` están fuera de git.

Prueba de punta a punta sin el navegador: `backend/scripts/camara_video_prueba/prueba_video.js`.

## 2. Vehículos sin placa visible

Antes, un auto nuevo sin placa, una moto (llevan placa solo atrás) o una placa tapada no dejaban
registro. Ahora `app/aplicacion/paso_sin_placa.py` vigila el movimiento (MOG2) dentro de la zona de
interés:

1. Un evento empieza cuando se mueve al menos el 4 % de la zona y termina tras 1,5 s sin movimiento.
   Solo se revisa si llegó al 15 % (`SIN_PLACA_FRACCION_VEHICULO`) y duró al menos 0,8 s.
2. El motor espera `SIN_PLACA_ESPERA_S` (5 s) a que el flujo de placas termine. Si en ese tiempo
   registró un paso, no hace nada.
3. Si no lo registró, el detector de vehículos YOLO26n (COCO) revisa los cuadros de mayor movimiento
   del evento. Exige un auto, moto, bus o camión con confianza ≥ 0,40, con al menos el 12 % del alto
   del cuadro y con el centro inferior de su caja dentro de la zona y fuera de las exclusiones. Una
   persona no se registra.
4. El paso se registra sin placa, con la foto del cuadro y el recorte del vehículo, y queda
   **pendiente de validación** con el motivo «Vehículo sin placa visible». Si durante el evento el
   detector vio algo con forma de placa, como el emblema de un auto nuevo, pero no hubo lectura, el
   motivo es «La placa no se pudo leer».

### Calibración (video real de la garita)

`ENTRADA_ECU_001`, 19-10-2026 de 07:40 a 08:10: 13 pasos detectados por un detector de vehículos
independiente del de placas (9 autos con placa, 2 autos nuevos sin placa, 1 moto y 1 falso
positivo). La fracción de la zona en movimiento, con el detector del motor a unos 10 cuadros/s:

| Qué se movió | Fracción máxima |
|---|---:|
| Autos | 0,64–0,91 |
| Moto | 0,25 |
| Guardia caminando | 0,03–0,07 |
| Guardia muy cerca de la cámara | 0,25 |

Con los umbrales anteriores, en esos 30 minutos el vigilante entrega 13 eventos para revisar. Cubren
los 12 pasos reales y agregan uno del guardia cerca de la cámara; este lo descarta el detector de
vehículos porque no es un vehículo. El movimiento por sí solo no separa a una persona cercana de una
moto. Por eso decide el detector de vehículos y el umbral de movimiento solo descarta lo evidente.

Limitaciones: un solo video, de un día, de mañana nublada y con una cámara. Antes de dar cifras en la
tesis hay que repetir la medición con otras condiciones (noche, lluvia, hora pico de la tarde),
siguiendo `docs/PROTOCOLO_EVALUACION_SECUENCIAS.md`.
