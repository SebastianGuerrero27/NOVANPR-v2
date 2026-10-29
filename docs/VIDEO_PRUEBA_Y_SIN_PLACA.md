# Calibración con el video de la garita y vehículos sin placa visible

## 1. Cámara de prueba con un video grabado (retirada)

Hasta el 28-10-2026, **Cámaras › Cargar video** creaba una cámara a partir de una grabación que
MediaMTX publicaba en bucle. Esa función se retiró: el sistema en operación solo procesa el flujo
RTSP de las cámaras registradas, y la grabación ya no se mezcla con los datos reales. Las
calibraciones de este documento se hicieron con ella.

Para medir el motor con grabaciones, fuera del sistema en operación, se usa
`services/anpr/scripts/evaluar_secuencias.py` (ver `docs/PROTOCOLO_EVALUACION_SECUENCIAS.md`). Las
grabaciones contienen placas (datos personales, LOPDP): `dataset/videos_garita/` está fuera de git.

## 2. Vehículos sin placa visible

Antes, un auto nuevo sin placa, una moto (llevan placa solo atrás) o una placa tapada no dejaban
registro. Ahora `app/aplicacion/paso_sin_placa.py` vigila el movimiento (MOG2) dentro de la zona de
interés:

1. Un evento empieza cuando se mueve al menos el 4 % de la zona y termina tras 1,5 s sin movimiento.
   Solo se revisa si llegó al 15 % (`SIN_PLACA_FRACCION_VEHICULO`), duró al menos 0,3 s y tuvo al
   menos 2 cuadros analizados con movimiento. Con unos 3 cuadros analizados por segundo, una moto
   que cruza en 2 s deja 2 o 3 muestras: el mínimo anterior de 0,8 s la dejaba fuera.
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

## 3. Un vehículo, un paso, y lecturas que no son placas

> Las placas de esta sección y de las pruebas del motor son **ficticias**: reemplazan a las del video
> (datos personales, LOPDP) y conservan sus confusiones de lectura (E/F, X/Y, D/O/0, un dígito sin
> leer). Las lecturas de lo que no es placa (el marco «ambacar», el emblema, el espejo) son las reales.

En la primera prueba con el video, el sistema dejó 19 registros para 12 vehículos. El motor analiza
unos 3 cuadros por segundo en el portátil y el seguimiento parte la placa de un mismo vehículo en
varias pistas, cada una con su propia lectura. A eso se sumaban lecturas de objetos que no son
placas. Reglas que se agregaron, cada una con su prueba:

| Regla | Dónde | Caso del video que la motivó |
|---|---|---|
| Una pista que continúa a otra ya registrada, o en registro, corrige ese paso en lugar de crear otro. Continúa si aparece a lo sumo 2,5 s después, a menos de 0,45 del ancho del cuadro y con una placa de 0,5 a 3 veces el tamaño anterior. Se evalúa en los dos sentidos | `app/aplicacion/consolidacion.py` | 4 registros del mismo auto en 6 s |
| El paso se reserva al decidir registrarlo; si otra pista lo corrige mientras tanto, la corrección se envía al terminar el registro | `motor.py` (3.1a, `_recordar_paso`) | TEN-394 y TBN-3950, del mismo auto, se registraron a la vez |
| Las cajas predichas por Kalman no cuentan como vistas de la placa | `detector.py` (`predicha`), `motor.py` | La pista vieja seguía «viva» 1,3 s y se solapaba con la nueva |
| La corrección exige una lectura legible (fila de 5 o más caracteres, ninguno inferido) y del mismo formato (auto o moto). Gana la placa claramente más grande, es decir, la más cercana | `consolidacion.lee_mejor`, `motor._consolidar` | El adoquinado leído SVT-584 reemplazó a SVU-584; PDO-418 pasó a PD-0418E |
| La reevaluación tardía de la pista original no reemplaza una corrección | `motor._reevaluar` | — |
| El segundo OCR solo reemplaza la lectura si su formato corresponde a la forma de la placa | `motor.py` | PDO-418 → PO-0418 (formato de moto) |
| Una lectura con 2 o más caracteres inferidos por el formato, y sin confirmación del segundo OCR, no se registra | `_MAX_CARACTERES_INFERIDOS` | Marco «ambacar» del concesionario: QIG6660, OIT6060, OIW6000 |
| Una lectura de auto en un recuadro casi cuadrado (ancho/alto < 1,15) no se registra, salvo que el segundo OCR la lea | `formato_coherente_con_la_placa` | Adoquinado del piso (0,79–1,03) |
| Una placa de moto solo se registra si el detector de vehículos ve una moto alrededor | `motor._en_motocicleta` | Emblema «T5 EVO» de un auto (TS-2117); espejo de otro (JB-5555) |

Si un paso pierde así su única lectura, lo registra el vigilante de pasos sin placa, con su foto.
Antes de dar por buena cualquiera de estas reglas, se miraron los recortes guardados: la placa real
del paso 11 es PXL-512, no PYL-512 como se había supuesto, así que la lectura de la pista cercana era
la correcta.

### Resultados con el mismo video (20-10-2026)

Son los 12 pasos del video: 9 autos con placa, el auto nuevo sin placa del paso 10, la moto y el auto
del concesionario, que trae el marco «ambacar» y no tiene placa.

| Pasada | Registros (ideal 12) | Pasos con más de un registro | Registros de algo que no es placa | Placas bien leídas (de 9) | Moto | Paso 10 sin placa |
|---|---:|---:|---:|---:|---|---|
| 1. Código anterior | 19 | 4 | 4 | 7* | No | Sí |
| 2. Primeras correcciones | 14 | 2 | 1 | 5 | Sí | Sí |
| 3. + reserva del paso y lectura cercana | 12 | 0 | 1 | 7 | Sí | Sí |
| 4. + inferidos ≥ 2 y verificador en recuadro cuadrado | 15 | 2 | 3 | 7 | Sí | No (emblema) |
| 5. + placa de moto sobre moto y mismo formato | 14 | 1 | 0 | 8 | Sí | Sí |
| 6. + sin cajas predichas y continuidad por tamaño | **12** | **0** | 1 | **8** | Sí | Sí |

\* En la pasada 1, un paso cuenta como bien leído si alguno de sus registros tiene la placa correcta.

Lo que queda:
- **Paso 1**: la placa está sucia o dañada (≈ SKU-582) y ninguna pasada la leyó bien.
- **Marco «ambacar»**: a veces lo frena la compuerta de caracteres inferidos (pasada 5) y a veces no
  (OHG-0000, QHI-0600). Su evidencia (lectura no confirmada, segundo OCR sin texto) es la misma que la
  de muchas placas reales lejanas, así que con reglas no se separa sin perder placas. Hace falta
  enseñarle al detector que esos marcos no son placas: afinarlo con esos recortes como ejemplos
  negativos (*hard negative mining*).
- Cada pasada se corrió una sola vez y el resultado varía entre pasadas del mismo video, porque los
  cuadros que alcanza a analizar el motor no son siempre los mismos. Las diferencias de 1 o 2
  registros entre pasadas no son concluyentes.

Limitaciones: un solo video, de un día, de mañana nublada y con una cámara. Antes de dar cifras en la
tesis hay que repetir la medición con otras condiciones (noche, lluvia, hora pico de la tarde),
siguiendo `docs/PROTOCOLO_EVALUACION_SECUENCIAS.md`.
