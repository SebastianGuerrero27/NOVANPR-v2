# Afinamiento con escenas reales y placas ecuatorianas (19-10-2026)

**Decisión: no se activa.** Mejora en la prueba compuesta ecuatoriana, pero pierde placas en las
dos pruebas con fotografías reales. Producción conserva `license_plate_detector.pt`
(SHA-256 `3667d8168e8a5a62fddf0992546efa0dc60f37578c9e95e8c0cbc92d4ed74c5c`).

## Qué se entrenó

El afinamiento del 18-10 con los 8 000 recortes de `dataset/openimages_plates_ecuatorianas` falló
porque la placa ocupa ~66 % de cada recorte: el detector aprendió que "la placa es la imagen"
(Open Images: FP de 149 a 5 394). Esta corrida usa los mismos recortes como textura:

- `scripts/componer_placas_ecuatorianas.py` rectifica cada placa con sus 4 esquinas (5 611 de
  7 200 recortes de train las tienen visibles), borra la placa real de una escena de Open Images
  V7 (inpainting) y pega la ecuatoriana en su lugar, con proporción 404 × 154 mm, perspectiva leve,
  la luz y el tono medidos sobre la placa original, desenfoque, ruido y compresión JPEG.
- Entrenamiento: 5 362 escenas compuestas (5 925 placas ecuatorianas, 1 918 originales conservadas)
  + 2 718 escenas originales de repaso = 8 080 imágenes. Validación: 719 escenas de Open Images val
  originales + sus 719 compuestas.
- Desde producción, 10 épocas, 512 px, batch 16, AdamW lr0 0,001, 10 capas congeladas, sin
  volteos, Docker CPU (i9-13900H, 4 hilos): 4 h 53 min. `best.pt` = época 5 (mAP50-95 de la
  validación mixta 0,621; producción 0,511 en la misma validación).
- Candidato: `services/anpr/models/yolo26n_ecuador_mixto_s0_20261019_152110_candidato.pt`
  (SHA-256 `9d690f2e…a0c2`) y su ONNX (mediana 42,7 ms solo red a 512 px).

## Pruebas independientes (nada de esto se usó para entrenar ni elegir la época)

Protocolo de la matriz de producción: `scripts/matriz_confusion_detector.py`, 512 px, IoU ≥ 0,5,
asignación voraz por confianza; 0,22 es el umbral del servicio. McNemar por placa frente a
producción.

| Prueba | Modelo | VP / placas @0,22 | Recall | FP | AP50 | McNemar (solo prod. / solo nuevo) |
|---|---|---:|---:|---:|---:|---|
| Open Images test, real e internacional (2 048 img.) | Producción | 2 361 / 2 816 | 83,8 % | 338 | 0,863 | — |
| | Afinado | 2 302 / 2 816 | **81,7 %** | 264 | 0,856 | 88 / 29, p = 8 × 10⁻⁸ (**peor**) |
| Compuesta ecuatoriana (escenas test + recortes val no usados) | Producción | 2 245 / 2 801 | 80,1 % | 369 | 0,825 | — |
| | Afinado | 2 368 / 2 801 | **84,5 %** | 232 | 0,879 | 8 / 131, p = 4 × 10⁻²⁵ (**mejor**) |
| Real ecuatoriana (105 fotos del piloto, 2 placas, 1 habitación) | Producción | 86 / 101 | 85,1 % | 9 | 0,883 | — |
| | Afinado | 81 / 101 | **80,2 %** | 11 | 0,786 | 6 / 1, p = 0,13 (peor, no significativo) |

Con confianza 0,35 (la de la matriz): producción VP 2 298 · FN 518 · FP 149; afinado VP 2 187 ·
FN 629 · FP 109 ([matriz](matriz_confusion_yolo26n_ecuador_afinado.svg)).

Recall por ancho de la placa (Open Images, @0,22): la pérdida no se limita a las placas pequeñas;
también baja en las de 128 px o más (95,5 % → 92,5 %). En las fotos reales del piloto baja en
64–128 px (73,1 % → 65,4 %) y ≥128 px (89,3 % → 85,3 %).

Criterio fijado antes de evaluar: activar solo si no pierde recall en Open Images, mejora en la
prueba ecuatoriana y no empeora en las fotos reales. Cumple solo el segundo.

## Interpretación

El modelo aprendió el aspecto de las placas pegadas (bordes, tipografía y textura del generador
sintético) mejor que el de las placas reales: mejora donde la prueba se parece al entrenamiento y
empeora en fotografías. Es una brecha entre lo sintético y lo real; con estos recortes no se cerró
ni con escenas reales de fondo ni con datos de repaso. La mejora de recall por vehículo en el
ECU 911 requiere fotografías reales de muchos vehículos y días (ver memoria de la tesis: ≥ 300 pasos
para acotar el recall por vehículo en 99 %).

Archivos: [Open Images](afinamiento_ecuador_openimages_2026-10-19.json) ·
[compuesta](afinamiento_ecuador_compuesto_2026-10-19.json) ·
[real](afinamiento_ecuador_real_2026-10-19.json) · curva por época en
`dataset/runs/yolo26n_ecuador_mixto_s0_20261019_152110/results.csv`.
