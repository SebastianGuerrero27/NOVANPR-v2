# Antecedentes investigativos del sistema web ANPR del ECU 911

**Tema:** Sistema web basado en ANPR para el registro de ingreso vehicular en la Coordinación Zonal 3 del Servicio Integrado de Seguridad ECU 911.  
**Fecha de revisión:** 28 de octubre de 2026.  
**Alcance:** revisión narrativa dirigida de fuentes primarias, con énfasis en reconocimiento, incertidumbre, evidencia temporal e inferencia en CPU. No constituye una revisión sistemática exhaustiva ni certifica superioridad frente a todos los métodos publicados.

**Nota editorial.** Se utiliza estilo IEEE con autores en la narración y numeración propia [1]–[13]. Al incorporar este apartado a la tesis, el gestor bibliográfico debe integrarla y reordenarla junto con las referencias del Anexo A y de `MARCO_TEORICO_TESIS.md`; estos números no sustituyen automáticamente los de aquellos documentos.

## 1. Evolución del problema y pertinencia del estudio

El reconocimiento automático de matrículas, denominado ANPR o ALPR, reúne localización y transcripción de información visual. Para el registro institucional, su utilidad depende además de asociar la lectura con un paso vehicular, conservar las imágenes y permitir corregir los resultados dudosos. En esta investigación se examinan antecedentes que ayudan a justificar esas decisiones, distinguiendo los resultados publicados por otros autores de las características efectivamente implementadas en el ECU 911. La comparación se realiza por problema abordado y condiciones de evaluación, porque una exactitud obtenida con determinada cámara, país o procesador no se convierte directamente en el rendimiento de esta aplicación.

### 1.1 Antecedente ecuatoriano: registro web mediante cámaras de vigilancia

González Quinga y Parrales Machuca desarrollaron en la Universidad Politécnica Salesiana un sistema web para registrar placas en parqueaderos. Su propuesta combinó sustracción de fondo, selección del fotograma, reducción de ruido, detección de contornos mediante Canny y OCR. El trabajo reportó una efectividad entre 70 % y 88 % en grabaciones diurnas, excluyendo condiciones climáticas adversas. Estos valores corresponden al protocolo de los autores y no constituyen una medición comparable con el conjunto actual del ECU 911. El antecedente demuestra pertinencia local del problema y permite identificar la necesidad de explicitar las condiciones de captura y los límites del reconocimiento. [[1]](https://dspace.ups.edu.ec/handle/123456789/22319)

La presente aplicación conserva la relación entre cámara, reconocimiento y registro web, e incorpora seguimiento, verificación de lectura y conservación del texto observado cuando no se confirma una matrícula. Esta diferencia describe el alcance del desarrollo realizado; por sí sola no demuestra una mejora cuantitativa respecto al sistema ecuatoriano citado, ya que no se han evaluado ambos sobre las mismas secuencias.

### 1.2 Detección mediante aprendizaje profundo y variabilidad geométrica

Laroca y colaboradores presentaron un sistema ALPR basado en YOLO y redes ajustadas para distintas etapas del reconocimiento. Evaluaron escenarios con variaciones de iluminación, fondo, cámara y movimiento, e introdujeron el conjunto UFPR-ALPR. Su investigación respalda la evaluación de la cadena completa, ya que localizar una región candidata y reconocer todos sus caracteres son resultados diferentes. Para este proyecto, el antecedente fundamenta la elección de un detector aprendido y la necesidad de evaluar eventos con condiciones variadas. Sus cifras de velocidad y reconocimiento no se adoptan como resultados de la CPU utilizada en el ECU 911. [[2]](https://arxiv.org/abs/1802.09567)

Silva y Jung abordaron la captura sin restricciones mediante una red capaz de localizar y rectificar placas afectadas por vistas oblicuas antes del OCR. El estudio vincula geometría de adquisición y legibilidad: la presencia de un rectángulo no asegura un recorte adecuado para transcribir caracteres. En el sistema desarrollado, este antecedente sustenta examinar tamaño, completitud y perspectiva de la región, junto con la selección del mejor cuadro. La rectificación constituye una herramienta disponible en la literatura; su incorporación o sustitución exige medir su contribución aislada y no atribuirle automáticamente una mejora en el entorno ecuatoriano. [[3]](https://www.ecva.net/papers/eccv_2018/papers_ECCV/papers/Sergio_Silva_License_Plate_Detection_ECCV_2018_paper.pdf)

## 2. Generalización, confianza y decisión de abstenerse

### 2.1 Generalización fuera del conjunto de entrenamiento

Laroca, Cardoso, Lucio, Estevam y Menotti compararon doce modelos OCR sobre nueve conjuntos públicos mediante particiones tradicionales y un protocolo que excluye un conjunto completo del entrenamiento. Encontraron caídas de desempeño al evaluar distribuciones no vistas. Este antecedente cuestiona el uso de buenos resultados dentro del mismo conjunto como prueba suficiente de generalización. En la investigación del ECU 911, justifica separar los datos por vehículo y secuencia, reservar escenarios no vistos y evitar que recortes o transformaciones del mismo paso aparezcan en entrenamiento y prueba. [[4]](https://arxiv.org/abs/2201.00267)

### 2.2 Confianza visual y calibración

Guo, Pleiss, Sun y Weinberger estudiaron la calibración de redes neuronales y mostraron que una predicción de alta confianza puede no representar adecuadamente su frecuencia real de acierto. Evaluaron métodos de calibración, entre ellos el escalado de temperatura. El antecedente permite distinguir la puntuación interna del modelo de una probabilidad empíricamente calibrada. En el sistema actual, se corrigió la elevación de confianza que podía producir una regla de formato: cumplir una estructura de matrícula ya no aumenta por sí solo la puntuación visual. Esta corrección mejora la interpretación de la evidencia, pero no equivale a haber calibrado estadísticamente el OCR. [[5]](https://proceedings.mlr.press/v70/guo17a.html)

Schirrmacher, Lorch, Maier y Riess investigaron explícitamente la incertidumbre del reconocimiento de placas bajo degradación y cambios de distribución. Compararon métodos probabilísticos con imágenes de baja resolución, ruido y desenfoque, buscando identificar predicciones incorrectas y advertir cuándo no confiar en ellas. Su trabajo respalda evaluar la detección del error, además del acierto del texto. La relación con el ECU 911 es conceptual: una salida sintácticamente válida puede ser visualmente injustificada. La aplicación no implementa por ello los estimadores probabilísticos del artículo ni hereda sus resultados experimentales. [[6]](https://arxiv.org/abs/2302.01427)

### 2.3 Reconocimiento selectivo y revisión humana

Geifman y El-Yaniv propusieron SelectiveNet, una arquitectura que aprende conjuntamente la predicción y la opción de rechazo. Su evaluación considera el compromiso entre riesgo y cobertura: una disminución del error debe interpretarse junto con la proporción de casos que el modelo acepta. Este enfoque sustenta medir cuántos pasos pueden resolverse automáticamente y cuántos necesitan revisión. La compuerta del ECU 911 es una regla heurística apoyada en el segundo OCR; no es una implementación entrenada de SelectiveNet. Su umbral debe ajustarse con datos de desarrollo y evaluarse con datos independientes. [[7]](https://proceedings.mlr.press/v97/geifman19a.html)

En el desarrollo realizado, abstenerse de asignar matrícula conserva el paso y sus fotos. Por ejemplo, un rótulo leído como `HAVAL / ambacar` se registra como observación OCR y no se fuerza a una secuencia de matrícula. La validación del personal permite completar posteriormente la identificación. Se aborda así un requisito operativo del proyecto: que la falta de una transcripción fiable no provoque ni la invención de identidad ni la pérdida de evidencia del vehículo.

## 3. Evidencia temporal y avances recientes

Zhang y colaboradores introdujeron ByteTrack, que asocia detecciones de distinta confianza para recuperar objetos y reducir la fragmentación de trayectorias. Su contribución corresponde al seguimiento de objetos, no a una garantía de transcripción de matrículas. Este antecedente fundamenta mantener la identidad temporal de una pista antes de combinar sus lecturas. El sistema actual utiliza seguimiento y asociación en dos fases con filtro de Kalman, junto con consenso por pista; esa adaptación no debe presentarse como una arquitectura de seguimiento nueva ni como reproducción completa del algoritmo publicado. [[8]](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001.pdf)

Na y colaboradores presentaron MF-LPR², que alinea y agrega cuadros vecinos mediante flujo óptico para restaurar y reconocer placas degradadas, procurando preservar la evidencia de entrada. También introdujeron RLPR, con doscientos pares de secuencias de baja calidad e imágenes de referencia de mayor calidad. El estudio respalda aprovechar observaciones temporales y advierte sobre restauraciones que introducen detalles no observados. Para esta investigación, motiva seleccionar y contrastar cuadros reales; no demuestra que incorporar su arquitectura completa cumpla el presupuesto de la CPU disponible. [[9]](https://arxiv.org/abs/2508.14797)

En 2026, Asil y Yoncacı propusieron Geo-CTM para asociar caracteres entre cuadros de cámaras en movimiento mediante restricciones geométricas. Su análisis muestra que la fusión temporal depende del protocolo y del modelo de movimiento: una asociación inadecuada puede deteriorar el reconocimiento. Al mantener el detector y el seguimiento comparables, el trabajo ayuda a separar el efecto de la fusión del efecto del rastreador. Para el ECU 911, sustenta evaluar el consenso con secuencias completas y ablaciones controladas, en lugar de asumir que acumular más votos siempre mejora la lectura. [[10]](https://pmc.ncbi.nlm.nih.gov/articles/PMC13611203/)

Como antecedente latinoamericano reciente, Auza Banegas y colaboradores describieron en el preprint BLPR un sistema para placas bolivianas con rectificación, corrección de iluminación y activación selectiva de un modelo de visión y lenguaje ante ambigüedad. El resumen reporta 89,6 % de exactitud **por carácter**, que no equivale a exactitud de matrícula completa. Su uso de Gemma3 4B no acredita que ese mecanismo tenga un costo aceptable en la CPU de este proyecto. Se retiene como referencia de procesamiento condicionado por confianza, diferenciando su condición de preprint de los artículos publicados. [[11]](https://arxiv.org/abs/2604.09927)

## 4. Restricción CPU y síntesis de los antecedentes

La ejecución en CPU exige evaluar el costo conjunto de detector, OCR, verificador, video y aplicación web. La documentación primaria de ONNX Runtime explica que cuantizar puede introducir pérdida de exactitud y que la mejora de velocidad depende del modelo y del hardware; incluso puede existir sobrecosto. OpenVINO documenta cuantización con control de la caída de una métrica mediante datos de calibración y validación. Estas herramientas sustentan una línea de optimización futura, sin permitir afirmar que el sistema ya dispone de una variante INT8 validada. El control de hilos y los presupuestos de tiempo implementados deben medirse mediante latencia p50/p95 y consumo de recursos. [[12]](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html), [[13]](https://docs.openvino.ai/2025/openvino-workflow/model-optimization-guide/quantizing-models-post-training/quantizing-with-accuracy-control.html)

| Antecedente | Aporte que se toma como fundamento | Relación y límite en este proyecto |
|---|---|---|
| González Quinga y Parrales Machuca, 2022 [1] | Registro web local a partir de cámaras. | Pertinencia ecuatoriana; condiciones y métricas no equivalentes. |
| Laroca et al., 2018; Silva y Jung, 2018 [2], [3] | Detección aprendida y tratamiento geométrico. | Fundamentan componentes; no prueban la exactitud del despliegue actual. |
| Laroca et al., 2022 [4] | Evaluación entre distribuciones. | Sustenta separación por vehículo, secuencia y escenario. |
| Guo et al., 2017; Schirrmacher et al., 2023 [5], [6] | Calibración e incertidumbre. | Puntuación visual y formato se separan; calibración todavía pendiente. |
| Geifman y El-Yaniv, 2019 [7] | Predicción con rechazo y riesgo–cobertura. | Fundamenta abstención; no se entrenó SelectiveNet. |
| Zhang et al., 2022; Na et al., 2025; Asil y Yoncacı, 2026 [8]–[10] | Asociación temporal y calidad de la fusión. | Consenso existente con costo acotado; requiere ablación por evento. |
| Auza Banegas et al., 2026 [11] | Segundo procesamiento selectivo ante ambigüedad. | Preprint y métrica por carácter; costo CPU no transferible. |
| ONNX Runtime y OpenVINO [12], [13] | Optimización con medición de rendimiento y calidad. | No se declara una mejora INT8 sin comparación experimental. |

## 5. Relación con la mejora implementada y alcance de la contribución

Los antecedentes respaldan una orientación común: la calidad de ANPR no puede reducirse a producir una cadena con formato válido. La aportación aplicada de este proyecto consiste en integrar detección, seguimiento, revisión de evidencia y registro web bajo una restricción CPU, conservando la posibilidad de abstención y de intervención humana. Los algoritmos de detección, seguimiento y OCR proceden de trabajos y herramientas existentes; la contribución propia se sitúa en su integración, las reglas de conservación de evidencia y la corrección de fallos identificados en el contexto institucional.

La mejora específica del OCR separa confianza visual y compatibilidad sintáctica; conserva el texto del lector general; evita asignar matrícula cuando se confirma un rótulo sin ella; y retira del seguimiento la hipótesis rechazada. El registro inicial y la reevaluación tardía permiten incorporar evidencia posterior sin sustituir decisiones confirmadas por el personal. Por otra parte, las listas conservan fotos propias del vehículo y del recorte real, con fechas y estados independientes. Esta última modificación corresponde a trazabilidad del software, y no debe confundirse con una ganancia de exactitud del modelo.

La evidencia disponible permite sostener una corrección de desarrollo acotada. El piloto contiene diez recortes de una sola matrícula presente en entrenamiento y un rótulo. El agente con el verificador existente acierta los diez positivos, pero asigna una matrícula falsa al rótulo; con las mismas inferencias y la nueva compuerta mantiene esos diez aciertos y rechaza ese negativo. No son once vehículos independientes ni una prueba de generalización. La diferencia respecto al agente especializado sin verificador pertenece a otro componente y no debe atribuirse a la compuerta. Los datos y las limitaciones están documentados en [el protocolo local](docs/OCR_CPU_RECONOCIMIENTO_SELECTIVO.md) y [el resultado reproducible](docs/resultados/ocr_selectivo_smoke_piloto_2026-10-27.json).

La pregunta evaluable es si la verificación selectiva disminuye las falsas matrículas en rótulos y otros negativos difíciles, manteniendo una cobertura útil y una latencia aceptable en CPU. Para responderla se necesita un conjunto independiente por vehículo y secuencia, anotaciones explícitas de negativos y ablaciones de confianza, compuerta y consenso. Deben medirse exactitud de matrícula completa, error de caracteres, falsas matrículas, riesgo–cobertura y latencia por evento. Solo después podrá estimarse la magnitud de la mejora. La implementación actual ofrece una base verificable para esa evaluación, sin acreditar todavía superioridad general sobre el estado del arte.

## Referencias

[1] D. J. González Quinga y D. L. Parrales Machuca, *Desarrollo de un sistema Web para el registro automático de placas vehiculares utilizando cámaras de vigilancia en parqueaderos*, trabajo de titulación, Universidad Politécnica Salesiana, Quito, Ecuador, 2022. [Repositorio institucional](https://dspace.ups.edu.ec/handle/123456789/22319).

[2] R. Laroca, E. Severo, L. A. Zanlorensi, L. S. Oliveira, G. R. Gonçalves, W. R. Schwartz y D. Menotti, “A Robust Real-Time Automatic License Plate Recognition Based on the YOLO Detector”, en *International Joint Conference on Neural Networks*, 2018, pp. 1–10. DOI: [10.1109/IJCNN.2018.8489629](https://doi.org/10.1109/IJCNN.2018.8489629). [Texto de los autores](https://arxiv.org/abs/1802.09567).

[3] S. M. Silva y C. R. Jung, “License Plate Detection and Recognition in Unconstrained Scenarios”, en *Computer Vision—ECCV 2018*, 2018. DOI: [10.1007/978-3-030-01258-8_36](https://doi.org/10.1007/978-3-030-01258-8_36). [Texto completo ECVA](https://www.ecva.net/papers/eccv_2018/papers_ECCV/papers/Sergio_Silva_License_Plate_Detection_ECCV_2018_paper.pdf).

[4] R. Laroca, E. V. Cardoso, D. R. Lucio, V. Estevam y D. Menotti, “On the Cross-dataset Generalization in License Plate Recognition”, en *International Conference on Computer Vision Theory and Applications (VISAPP)*, 2022. DOI: [10.5220/0010846800003124](https://doi.org/10.5220/0010846800003124). [Texto de los autores](https://arxiv.org/abs/2201.00267).

[5] C. Guo, G. Pleiss, Y. Sun y K. Q. Weinberger, “On Calibration of Modern Neural Networks”, en *Proceedings of the 34th International Conference on Machine Learning*, PMLR, vol. 70, 2017, pp. 1321–1330. [Publicación oficial](https://proceedings.mlr.press/v70/guo17a.html).

[6] F. Schirrmacher, B. Lorch, A. Maier y C. Riess, “Benchmarking Probabilistic Deep Learning Methods for License Plate Recognition”, *IEEE Transactions on Intelligent Transportation Systems*, 2023. DOI: [10.1109/TITS.2023.3278533](https://doi.org/10.1109/TITS.2023.3278533). [Texto de los autores](https://arxiv.org/abs/2302.01427).

[7] Y. Geifman y R. El-Yaniv, “SelectiveNet: A Deep Neural Network with an Integrated Reject Option”, en *Proceedings of the 36th International Conference on Machine Learning*, PMLR, vol. 97, 2019, pp. 2151–2159. [Publicación oficial](https://proceedings.mlr.press/v97/geifman19a.html).

[8] Y. Zhang, P. Sun, Y. Jiang, D. Yu, F. Weng, Z. Yuan, P. Luo, W. Liu y X. Wang, “ByteTrack: Multi-Object Tracking by Associating Every Detection Box”, en *Computer Vision—ECCV 2022*, 2022. [Texto completo ECVA](https://www.ecva.net/papers/eccv_2022/papers_ECCV/papers/136820001.pdf).

[9] K. Na, J. Oh, Y. Cho, B. Kim, S. Cho, J. Choi e I. Kim, “MF-LPR²: Multi-Frame License Plate Image Restoration and Recognition using Optical Flow”, *Computer Vision and Image Understanding*, vol. 256, art. 104361, 2025. DOI: [10.1016/j.cviu.2025.104361](https://doi.org/10.1016/j.cviu.2025.104361). [Texto de los autores](https://arxiv.org/abs/2508.14797).

[10] U. Asil e İ. Yoncacı, “Geometry-Constrained Multi-Frame Character Association for License Plate Recognition on Moving Cameras”, *Sensors*, vol. 26, n.º 18, art. 5704, 2026. DOI: [10.3390/s26185704](https://doi.org/10.3390/s26185704). [Texto completo](https://pmc.ncbi.nlm.nih.gov/articles/PMC13611203/).

[11] G. Auza Banegas, D. Calvimontes Vera, N. Condori Peredo, E. Salcedo y S. Castro Sandoval, “BLPR: Robust License Plate Recognition under Viewpoint and Illumination Variations via Confidence-Driven VLM Fallback”, *arXiv*, preprint, versión 2, 2026. DOI: [10.48550/arXiv.2604.09927](https://doi.org/10.48550/arXiv.2604.09927). [Texto de los autores](https://arxiv.org/abs/2604.09927v2).

[12] Microsoft, “Quantize ONNX models”, *ONNX Runtime Documentation*. Consulta: 28 oct. 2026. [Documentación oficial](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html).

[13] Intel, “Quantizing with Accuracy Control”, *OpenVINO Documentation*, edición 2025. Consulta: 28 oct. 2026. [Documentación oficial](https://docs.openvino.ai/2025/openvino-workflow/model-optimization-guide/quantizing-models-post-training/quantizing-with-accuracy-control.html).
