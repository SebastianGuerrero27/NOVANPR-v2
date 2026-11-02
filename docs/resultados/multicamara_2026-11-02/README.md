# Varias cámaras en el motor ANPR: mediciones del 2026-11-02

**Conclusión:** un motor analiza bien hasta **4 cámaras** en este equipo (i9-13900H, 14 núcleos y 20 hilos, sin GPU). Más allá hay que agregar otro equipo. Por eso `ANPR_MAX_CAMARAS` vale 4 por omisión.

## Cómo se midió

- Arnés aislado (`backend/scripts/carga/`): base en memoria y sin tocar el sistema real.
- Cada cámara simulada repite por RTSP el mismo video de 180 s (1080p, 30 fps), **en fase**. Es el peor caso: todas ven vehículos a la vez.
- Cada corrida dura 360 s y se esperan 10 lecturas por cámara.
- Una lectura es exacta si coincide con la placa real. Los resultados no contienen placas.
- «Confirmadas erróneas» son lecturas equivocadas que el motor dio por válidas.
- Hay más exactas que esperadas cuando un vehículo se registra dos veces.

## Resultado por configuración

Detector en PyTorch, intervalo del GIL de 0,5 ms y 2 hilos de OpenCV, salvo donde se indica.

| Cámaras | Motores | Exactas | Confirmadas erróneas | Núcleos | RAM máx. | Captura | Registro p50 | Registro p95 | Archivo |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 10/10 | 0 | 8,9 | 1,4 GB | 29 fps | 0,48 s | 0,95 s | `pt_1_camara_a` |
| 1 | 1 | 9/10 | 0 | 9,1 | 1,4 GB | 29 fps | 0,48 s | 0,90 s | `pt_1_camara_b` |
| 2 | 1 | 18/20 | 0 | 4,6 | 2,1 GB | 30 fps | 1,1–1,4 s | 3,0–3,5 s | `un_proceso_2` |
| 4 | 1 | **40/40** | 0 | 6,4 | 3,0 GB | 30–33 fps | 3,3–5,7 s | 5,4–10,8 s | `un_proceso_4` |
| 4 | 1 | **36/40** | 0 | 5,9 | 3,3 GB | 29–30 fps | 1,9–4,2 s | 3,7–6,1 s | `pt_4` |
| 6 | 1 | 14/60 | 0 | 10,9 | 5,1 GB | 21–25 fps | 8,0–17,9 s | 8,0–18,6 s | `pt_6` |

Los rangos van de la mejor a la peor cámara. El límite está entre 4 y 6 cámaras: a 6, el motor ya no alcanza a leer antes de que el vehículo salga.

**Una cámara, antes y después del cambio** (orden A B B A): la versión anterior leyó 8 y 9 de 10; la nueva, 8 y 9 de 10. Sin regresión. Archivos `anterior_1_camara_*` y `nueva_1_camara_*`.

## Lo que se probó y no sirvió

### Un proceso por cámara

Cada motor consume toda la CPU que encuentra (unos 9 núcleos con una sola cámara) y compite con los demás.

| Cámaras | Motores | Exactas | Confirmadas erróneas | Núcleos | Captura |
|---:|---:|---:|---:|---:|---:|
| 2 | 2 | 21/20 | 0 | 18,8 | 25–29 fps |
| 4 | 4 | 27/40 | 1 | 19,7 | 14–32 fps |
| 6 | 6 | 15/60 | 2 | 20,1 | 7–17 fps |

Con 4 cámaras, un proceso compartido gasta un tercio de la CPU y lee más. Dos motores solo convienen en **equipos distintos**. En un mismo equipo, 8 cámaras en 2 motores leyeron 33/80 (`ov_8_en_2_motores`).

### Detector compilado con OpenVINO

En un banco aislado parecía la solución. Con 4 hilos Python ocupados, el detector tardaba 194 ms frente a 1242 ms de PyTorch, con detecciones idénticas en 360 cuadros reales (91 de 91, IoU 1,0). De punta a punta no se sostuvo:

| Cámaras | Formato | Exactas | Confirmadas erróneas | Núcleos | Captura | Análisis por cámara |
|---:|---|---:|---:|---:|---:|---:|
| 1 | PyTorch | 10 y 9 de 10 | 0 | 9,0 | 29 fps | 17–20 fps |
| 1 | OpenVINO | 9 y 8 de 10 | 1 | 12,2 | 30 fps | 11–13 fps |
| 4 | PyTorch | 40 y 36 de 40 | 0 | 5,9–6,4 | 29–33 fps | 0,5–0,9 fps |
| 4 | OpenVINO | 40 y 34 de 40 | 2 | 13,4 | 20–26 fps | 0,9–1,0 fps |
| 6 | PyTorch | 14/60 | 0 | 10,9 | 21–25 fps | ~0 fps |
| 6 | OpenVINO | 36/60 | 1 | 14,6 | 11–18 fps | 0,4 fps |
| 8 | OpenVINO | 31/80 | 1 | 14,5 | 8–14 fps | 0,1 fps |

Hasta 4 cámaras gasta el doble de CPU, degrada la captura y no lee más. A 6 lee más que PyTorch, pero 60 % sigue sin servir. **Se descartó** y el código se retiró.

## Por qué el GIL importa

Cuántos milisegundos tarda una inferencia del detector, según cuántos otros hilos Python estén ocupados:

| Hilos Python ocupados | Intervalo del GIL 5 ms (por omisión en Python) | 0,5 ms |
|---:|---:|---:|
| 0 | 39 ms | 46 ms |
| 1 | 1773 ms | 309 ms |
| 4 | 10 381 ms | 1843 ms |

Por eso se fijaron `ANPR_INTERVALO_GIL_MS=0.5` y `ANPR_HILOS_OPENCV=2`. Con una cámara son neutros: 7/7 en ambos casos, mismo consumo. Con 4 cámaras en un proceso, la serie anterior con los valores por omisión leyó 33/40, con registro p95 de 40 s (`un_proceso_primera_serie/`). Con el ajuste, 40/40 y 36/40, con p95 de 4–11 s. Esa serie anterior no aísla cada ajuste por separado.

## Qué limita hoy

Con 4 cámaras, cada una se analiza cerca de **1 vez por segundo**, frente a 17–20 con una sola. El detector da unas 4 inferencias por segundo con esta contención, y las cámaras hacen fila (p50 de 1,1 s por cuadro).

Para el video de la garita alcanza, porque los vehículos pasan despacio. **No se midió con vehículos rápidos**: a 1 análisis por segundo, un vehículo que cruza en 1–2 s puede perderse. Hay que probarlo antes de usar el sistema en una vía.

El siguiente paso para más capacidad por equipo sería llevar el detector a un proceso aparte que atienda a todas las cámaras, o usar GPU. No se probó ninguno de los dos.

## Lo que no se midió

- Cámaras físicas, H.265, cortes de red o cámaras de otra resolución.
- Dos motores en dos equipos reales: el reparto se verificó en un solo equipo (`multicamara_funcional.sh`, 44 de 44 verificaciones), sin medir la calidad de lectura.
- Una cámara de salida real: la salida automática se probó con lecturas simuladas por la API.
- Corridas largas: cada una dura 6 minutos. Las diferencias de 1 o 2 lecturas entre corridas son ruido normal.
