# Alcance y vehículos en movimiento

El pipeline aplica dos ajustes para reducir las pérdidas de placas pequeñas durante el paso de
vehículos:

- Cuando MOG2 localiza una región de movimiento acotada, el detector usa un recorte ampliado con
  contexto. El recorte se lleva a los 512 px de inferencia habituales, por lo que la placa puede
  ocupar más píxeles que en un cuadro completo sin aumentar el tamaño de entrada del modelo.
- Se mantiene una inferencia de cuadro completo por cada tres llamadas al detector. Esto conserva
  cobertura para vehículos detenidos y para objetos que no coincidan con la región de movimiento.
  Si existe una región de interés configurada y válida, tiene prioridad sobre el recorte dinámico.
- Una detección con confianza inferior a 0,23 (23 %) no genera una ROI utilizable por el OCR ni
  una captura seleccionada. El motor la descarta antes de guardar imágenes y el backend vuelve a
  aplicar el mismo límite antes de crear el registro; una solicitud baja que llegue al backend
  queda en la auditoría de descartes, no en la tabla de ingresos. Exactamente 0,23 sí pasa este
  filtro, aunque todavía debe cumplir las demás validaciones de lectura y de acceso. El backend
  también rechaza solicitudes sin una confianza numérica válida para evitar que un paso sin
  evidencia eluda el límite.
- Las detecciones débiles que queden por debajo de ese límite pueden iniciar una pista interna solo
  tras aparecer en dos inferencias consecutivas y asociarse geométricamente. Esa pista no se envía
  al OCR ni se registra.
- El umbral filtra la confianza del detector, no la del OCR. Detecciones desde 0,23 aún pueden ser
  falsos positivos, por lo que se mantienen las validaciones geométricas, OCR y de lista de acceso.

Estos cambios mejoran las oportunidades de detección, pero no certifican un alcance fijo —por
ejemplo, 2 m— ni exactitud bajo cualquier velocidad, iluminación o ángulo. El resultado depende de
la resolución y óptica de la cámara, del tamaño de la placa en píxeles, del desenfoque, la compresión
y los datos con que se entrenó el detector. Tampoco se debe usar la distancia óptica estimada por
el sistema como una medición validada sin calibrar la cámara.

## Validación necesaria en la cámara instalada

Grabar y etiquetar clips con vehículos detenidos y en movimiento a distancias conocidas (incluidas
distancias mayores a 2 m), de día y de noche. Comparar la versión anterior y la nueva sobre los
mismos clips, midiendo:

1. recall de detección por intervalo de distancia y condición de iluminación;
2. exactitud OCR de placa completa y tasa de falsas lecturas/ingresos;
3. latencia p50/p95 del detector, cuadros procesados y cuadros descartados;
4. resultados separados por velocidad, ángulo y resolución de la fuente.

No promover el cambio como mejora cuantificada de alcance hasta completar esa evaluación. La
confirmación temporal de candidatos débiles reduce las pistas espurias, pero la autorización o el
registro debe seguir dependiendo de la validación OCR y de las reglas del backend.
