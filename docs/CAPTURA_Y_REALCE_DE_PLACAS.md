# Captura y realce de placas

La lectura depende primero de la imagen. Una placa de 65 px de ancho, movida u oscura se lee mal con
cualquier OCR, y ningún entrenamiento recupera píxeles que la cámara no capturó. Este documento
cubre tres cosas:

1. Cómo ajustar la cámara.
2. El diagnóstico que el sistema hace en cada paso.
3. Un método de realce medido para el OCR, que todavía **no está activado**, y lo que falta para
   publicarlo.

## 1. Ajuste de la cámara (lo que más mejora la lectura)

| Ajuste | Objetivo | Por qué |
|---|---|---|
| Zoom o encuadre | Placa de **130–180 px de ancho** en la imagen principal | Con 65 px el OCR pierde caracteres (§3) |
| Obturación (shutter) | **1/250 s o más rápida**; 1/500–1/1000 s si los vehículos no se detienen | El movimiento durante la exposición borra los caracteres: con 6 px de desenfoque la lectura cae al 20 % |
| Enfoque | Fijo en la línea de paso, no automático | El autofoco busca en cada vehículo |
| Noche | Infrarrojo con alcance hasta la línea de paso; ganancia moderada | Sin luz la obturación rápida deja la placa negra, y la ganancia alta agrega ruido |
| Faros y sol | BLC/HLC o WDR | Una placa quemada (saturada) no tiene caracteres |
| Códec | H.264 en el flujo principal | Video en el navegador sin transcodificar (RNF10) |
| Zona de interés | Solo la franja donde pasan las placas | Menos falsas detecciones y menos CPU |

En cámaras Hikvision están en Configuración › Imagen › Parámetros de pantalla (Exposición, Enfoque,
Contraluz, Día/Noche) y en Configuración › Video/Audio (códec y resolución).

## 2. Diagnóstico de la captura en el sistema

El motor mide cada placa que registra (`services/anpr/app/aplicacion/calidad_captura.py`):

- **Ancho:** en píxeles.
- **Nitidez:** varianza del laplaciano con el recorte llevado a 64 px de alto, para que no dependa del tamaño.
- **Brillo:** medio del recorte.
- **Saturación:** fracción de píxeles quemados.

Con las medianas de las últimas 40 placas, y desde 5, Monitoreo muestra qué ajustar. Ejemplo: «Las placas miden unos 72 px de ancho: acerque el zoom…».

| Umbral | Valor | Calibración con recortes reales de la garita |
|---|---|---|
| Ancho mínimo | 130 px | Lectura por recorte 76,9 % con 65 px frente a 82,7 % con ~80 px (§3) |
| Nitidez mínima | 450 | Mediana nítida 1326; movida 3 px, 594; movida 6 px, 387 |
| Brillo mínimo | 70 | Día 86; noche simulada 27 |
| Saturación máxima | 12 % de píxeles | Valor inicial; no se calibró por falta de escenas con faros |

De noche la poca luz también baja la nitidez. Por eso, con poco brillo, se pide luz y no otra
obturación.

`/status` del motor devuelve todo esto en `camaras[].calidad_captura`.

## 3. Realce por acuerdo entre lectores (ASAL): método medido, no activado

### Idea

El sistema tiene dos lectores independientes: fast-plate-ocr (rápido) y PP-OCRv6 (texto general).
El método ASAL hace esto con cada placa:

1. Genera variantes baratas del recorte: original, gamma automática, CLAHE, reducción de ruido y
   ampliación con realce de bordes.
2. El lector rápido lee todas; PP-OCRv6 lee la original y la mejor variante.
3. Elige la placa con formato ANT que más lectores y variantes respaldan.

No usa ningún modelo nuevo y elige el realce en cada placa, sin reglas de día o noche. La variante
segura (M3) deja la **confirmación** como en producción: solo confirma si los dos lectores coinciden
en la imagen original. Así, el realce corrige la placa que se registra sin crear confirmaciones
nuevas.

### Banco de pruebas

- **Recortes:** 104 recortes reales de 8 vehículos del video de la garita, de día, a 4 cuadros por
  segundo y con el detector de producción. Mediana de **72 px** de ancho.
- **Condiciones** sobre el mismo recorte: original; noche simulada (8 % de la luz, ruido de disparo y
  de lectura, JPEG 45); placa pequeña (65 px); movida (6 px).
- **Medidas:** lectura exacta, lecturas erróneas que se dan por confirmadas y vehículos correctos
  por voto de sus recortes.
- **Script:** `services/anpr/scripts/banco_realce_acuerdo.py`.
- **Resultados sin placas:** `docs/resultados/realce_acuerdo_2026-11-03/`.

| Condición | M0 producción | M1 realce clásico | M2 ASAL | M3 ASAL seguro | Confirmadas erróneas M0 / M2 / M3 |
|---|---:|---:|---:|---:|---|
| Original | 82,7 % | 83,7 % | 86,5 % | 86,5 % | 0 / 2 / 0 |
| Noche simulada | 57,7 % | 54,8 % | 63,5 % | 63,5 % | 4 / 5 / 4 |
| Placa pequeña | 76,9 % | 73,1 % | 86,5 % | 86,5 % | 0 / 1 / 0 |
| Movida | 20,2 % | 21,2 % | 22,1 % | 22,1 % | 1 / 2 / 1 |

Prueba de McNemar exacta, M3 frente a M0, por recorte. La unidad independiente es el vehículo:

| Condición | Recortes que mejoran / empeoran | p | Vehículos que mejoran / empeoran / iguales |
|---|---|---:|---|
| Original | 4 / 0 | 0,125 | 1 / 0 / 7 |
| Noche simulada | 8 / 2 | 0,109 | 4 / 1 / 3 |
| Placa pequeña | **10 / 0** | **0,002** | 4 / 0 / 4 |
| Movida | 3 / 1 | 0,625 | 2 / 1 / 5 |

### Lectura honesta de los resultados

- **Placa pequeña:** es la única condición con mejora significativa (p = 0,002). Es justo el caso
  de una cámara sin el zoom suficiente.
- **Confirmaciones:** M2 sube las lecturas erróneas confirmadas; M3 no.
- **Realce clásico (gamma + CLAHE):** no mejora y de noche empeora, igual que el benchmark anterior
  del proyecto.
- **Movimiento:** ningún realce lo recupera. Lo resuelve la obturación.
- **Por vehículo:** el sistema real vota varios cuadros por vehículo. De día, M0 y M3 aciertan 8 de 8;
  la mejora por vehículo se ve solo en placa pequeña (7/8 → 8/8).
- **Costo:** de 0,5 a 1 s más de CPU por vehículo, con la CPU compartida (p50 de 1,0–1,6 s frente a
  0,4–0,75 s).

### Por qué no está activado

En el día no cambia el resultado por vehículo, cuesta CPU y tocaría la parte del motor que hoy no
confirma ninguna lectura falsa. Se activaría solo si una prueba de punta a punta
(`scripts/evaluar_secuencias.py`) con video real de noche o con placas pequeñas muestra más vehículos
correctos sin más confirmaciones falsas.

### Novedad y lo que falta para un artículo

**Lo que ya existe:**
- La fusión de varios cuadros alineados con flujo óptico: MF-LPR², CVIU 2025.
- El promedio de recortes alineados con ECC.
- El voto entre lecturas.
- Los realces de baja luz elegidos por condición: por clima, o con módulos separados de día y noche.

**Lo que no encontramos publicado:** usar el **acuerdo entre dos lectores heterogéneos** para elegir
el realce de cada placa, manteniendo la regla de confirmación. Eso no prueba que no exista. Antes de
afirmar novedad hace falta una revisión sistemática (Scopus/IEEE/ACM, 2015–2026).

**Para que sea publicable:**
1. Datos reales de noche y con placas pequeñas: al menos 30–50 vehículos por condición y más de una
   cámara. Hoy la noche es simulada y solo hay 8 vehículos.
2. La unidad de análisis debe ser el vehículo, con intervalos de confianza por bootstrap por vehículo.
3. Comparación con un banco público con texto y noche (RodoSol-ALPR, CCPD-DB/Blur) y con la fusión de
   varios cuadros (MF-LPR²).
4. Ablaciones: qué variante aporta, cuántas variantes hacen falta y el costo de cada una.
5. Prueba de punta a punta en el motor, con latencia y confirmaciones falsas.

### Referencias

- [MF-LPR²: Multi-Frame License Plate Image Restoration and Recognition using Optical Flow (CVIU, 2025)](https://arxiv.org/pdf/2508.14797)
- [HAT Super-Resolution and a PARSeq+CLIP4STR Voting Ensemble for Extreme In-the-Wild License Plate Recognition (2026)](https://arxiv.org/pdf/2607.08896)
- [Low Light Image Enhancement in License Plate Recognition using URetinex-Net and TRBA (Procedia CS, 2024)](https://www.sciencedirect.com/science/article/pii/S1877050924003788)
- [Research on Image Adaptive Enhancement Algorithm under Low Light in License Plate Recognition System](https://www.researchgate.net/publication/345268139_Research_on_Image_Adaptive_Enhancement_Algorithm_under_Low_Light_in_License_Plate_Recognition_System)
- [Design of Enhanced License Plate Information Recognition Algorithm Based on Environment Perception](https://www.researchgate.net/publication/389302034_Design_of_Enhanced_License_Plate_Information_Recognition_Algorithm_Based_on_Environment_Perception)
- [Toward Advancing License Plate Super-Resolution in Real-World Scenarios: A Dataset and Benchmark (JBCS)](https://journals-sol.sbc.org.br/index.php/jbcs/article/view/5159)
