# Detección de matrículas con baja iluminación

El flujo en vivo estima la iluminación de cada fotograma a partir de la luminancia
media y el percentil 75, calculados sobre una muestra reducida. Si ambas medidas
indican una escena oscura, aplica una curva gamma acotada y CLAHE sobre la
luminancia antes de la inferencia YOLO. La misma corrección se usa en la segunda
pasada de OCR cuando el recorte de la placa también está subexpuesto.

El realce es condicional: las escenas con iluminación suficiente se procesan
sin modificar, y el fotograma original se conserva para el video, las cajas
del detector, el seguimiento y las capturas. El cambio no ejecuta una segunda
inferencia YOLO ni añade un modelo neuronal al ciclo en vivo. El seguimiento y
el consenso OCR multi-fotograma que ya existen siguen verificando las lecturas.

## Fundamento y límites

La literatura de mejora de baja iluminación explora tanto transformaciones
adaptativas como modelos aprendidos. Zero-DCE estima curvas de iluminación
específicas para cada imagen sin requerir pares de referencia; Retinexformer
emplea una arquitectura basada en Retinex y Transformers para la mejora de
imágenes oscuras. Estos enfoques justifican adaptar la exposición a la escena,
pero un modelo neuronal adicional no se incorpora aquí: el motor debe sostener
la inferencia de video en CPU y la prioridad es no aumentar su latencia de forma
impredecible. La curva gamma limitada más CLAHE es una alternativa ligera y
determinista que se puede medir en el despliegue actual.

El realce no recupera información que el sensor no capturó. Aumentar la
exposición también hace más visibles el ruido, el desenfoque y la compresión;
por eso el realce se activa solo en escenas oscuras, se limita la curva y se
mantienen los filtros de nitidez y el consenso de varias lecturas. La placa
puede seguir siendo ilegible si tiene pocos píxeles, está saturada por faros,
fuera de foco o si la cámara no tiene iluminación infrarroja suficiente.

## Validación antes de afirmar una mejora

Los umbrales de luminancia son iniciales y no sustituyen una evaluación con
grabaciones de las cámaras reales. Antes de reportar una mejora, comparar en el
mismo conjunto diurno/nocturno y por cámara:

- recall de detección de placas y AP50/AP50:95;
- exactitud de placa completa (coincidencia exacta) y tasa de caracteres;
- falsos positivos por hora y lecturas erróneas con formato ANT válido;
- latencia p50/p95 del detector y del ciclo OCR;
- resultados separados por oscuridad, faros/deslumbramiento, lluvia, distancia
  y tamaño en píxeles de la placa.

Conservar el fotograma original y ejecutar el mismo detector con y sin realce
sobre clips etiquetados. Si el recall sube pero también aumentan placas falsas
o la latencia excede el presupuesto operativo, ajustar los umbrales o no activar
el realce en esa cámara. La imagen de ejemplo motiva este ajuste visual, pero no
es suficiente por sí sola para cuantificar la precisión.

## Referencias

- Guo, C. et al. (2020). *Zero-Reference Deep Curve Estimation for Low-Light
  Image Enhancement*. CVPR. https://openaccess.thecvf.com/content_CVPR_2020/html/Guo_Zero-Reference_Deep_Curve_Estimation_for_Low-Light_Image_Enhancement_CVPR_2020_paper.html
- Cai, Y. et al. (2023). *Retinexformer: One-stage Retinex-based Transformer
  for Low-light Image Enhancement*. ICCV. https://arxiv.org/abs/2303.06705
