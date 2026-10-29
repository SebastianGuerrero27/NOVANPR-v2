# Reconocimiento selectivo de matrículas y rótulos en CPU

Fecha del protocolo y consulta de fuentes: **2026-10-27**.

Este documento separa el diagnóstico de un caso de desarrollo, las mejoras propuestas y la
evaluación necesaria para un artículo. No declara exactitud perfecta, superioridad frente al
estado del arte ni una novedad mundial. Esas afirmaciones exigirían un estudio comparativo
independiente que todavía no se ha realizado.

## 1. Problema y comportamiento esperado

La imagen aportada muestra un rótulo de concesionario con los textos «HAVAL» y «ambacar».
El usuario reportó que el sistema lo registró como `QIH-6060`. En este recorte no hay una
matrícula alfanumérica que deba reconstruirse. El usuario confirmó que quiere conservar el
texto libre del rótulo como observación.

El objetivo para este caso es registrar el paso del vehículo y su evidencia, dejar la matrícula
sin lectura y conservar el texto general como observación. El texto `HAVAL / ambacar` no debe
convertirse en una matrícula para satisfacer un patrón de tres letras y cuatro dígitos. Tampoco
debe convertirse automáticamente en marca o propietario: sigue siendo texto observado en la
imagen hasta que otro proceso o una persona confirme su significado.

Esto distingue tres tareas:

1. Detectar un vehículo o una región candidata a placa.
2. Decidir si esa región ofrece evidencia de una matrícula legible.
3. Transcribirla, o conservar texto general y abstenerse de producir matrícula.

Una región rectangular detectada con confianza no demuestra que contenga una matrícula. Una
salida OCR que cumple el formato tampoco demuestra que sus caracteres estén en los píxeles.

## 2. Diagnóstico medido del caso de desarrollo

Identificación del archivo original: PNG de **146 × 96 píxeles**, SHA-256
`1de5723dfb3033096fc5a2b4deef9670f4712e2d2d3df535ff6b2392e2fd3684`.

El diagnóstico ejecutó componentes existentes sobre esa imagen, sin enviar sus resultados al
backend. Las siguientes cifras describen las salidas observadas antes de la corrección; **no son
resultados de un conjunto de prueba ni una estimación de precisión**.

| Componente existente | Salida observada | Confianza entregada |
|---|---|---:|
| OCR especializado FastPlate, salida cruda | `01110601` | 0,6561 |
| `PlateEnhancementAgent`, interpretación como matrícula | `OII-1060` | 1,0 |
| PP-OCRv6, texto general | `ambacar` | 0,99662 |
| PP-OCRv6, texto general | `HAVAL` | 0,98753 |
| PP-OCRv6, extracción de matrícula | Vacía | No aplicable |

No se reprodujo exactamente `QIH-6060` en este recorte aislado. El resultado de una captura de
video puede depender del cuadro elegido, del recorte, del preprocesamiento y del historial del
track. No se debe atribuir esa lectura exacta a este experimento ni sustituir la evidencia
original del acceso por la salida de la reproducción.

Las confianzas de diferentes motores no son directamente comparables ni probabilidades
calibradas de «matrícula correcta». En particular, el valor 1,0 del agente no demuestra una
lectura perfecta. En la versión diagnosticada, `plate_agent.py` utilizaba
`max(score, format_score)`: una puntuación de formato podía elevar la confianza final aunque
el reconocimiento visual fuera inseguro. La corrección debe separar esas cantidades.

Los tiempos de este diagnóstico concurrente con el monitoreo no se usan como benchmark
aislado de latencia. No se incluyen cifras de mejora de velocidad o precisión sin una medición
controlada posterior.

### Implementación y prueba de regresión, 2026-10-28

La mejora ya está implementada. Se preserva la puntuación visual de los tokens sin elevarla
por el formato; el OCR general conserva su texto abierto. La compuerta operativa se abstiene
cuando ese lector no devuelve matrícula y observa texto alfabético de al menos cuatro letras,
con confianza mínima de 0,90. Las cabeceras ECUADOR/ANT solas no activan la compuerta.
El umbral es heurístico y debe calibrarse; no ofrece una garantía estadística de error.

La observación se guarda en `evidencia_lectura.observacion_ocr`; el texto libre no se asigna
al campo matrícula. Se conservan fotos, candidata descartada y puntuación del texto. Una lectura
tardía puede retirar la candidata automática del mismo registro. Si el rótulo pertenece a otra
pista de un vehículo ya registrado, se adjunta la observación a ese acceso y se conserva su
matrícula. La capa de seguimiento retira la hipótesis rechazada del HUD y bloquea votos tardíos.

La regresión de desarrollo guardada en
[`resultados/ocr_selectivo_smoke_piloto_2026-10-27.json`](resultados/ocr_selectivo_smoke_piloto_2026-10-27.json)
usa diez recortes conocidos del piloto, de **una matrícula presente en entrenamiento**, y el
rótulo adjunto. No es una muestra independiente ni una evaluación de generalización:

| Configuración del evaluador de recortes | Matrículas correctas en 10 positivos conocidos | Matrículas falsas en el único rótulo |
|---|---:|---:|
| Agente especializado | 9 | 1 |
| Agente + verificador existente, sin compuerta | 10 | 1 |
| Mismas inferencias + compuerta de texto observado | 10 | 0 |

El cambio de 9 a 10 corresponde al verificador que ya existía. El aporte aislado de la nueva
compuerta en esta prueba es rechazar ese rótulo sin perder esos diez positivos conocidos;
**no demuestra una tasa de falsos positivos cero en producción**. Los tiempos del JSON son
secuenciales, con otros servicios activos, y no representan la latencia del motor en paralelo.

El PNG original se conserva, sin modificación, en
`services/anpr/tests/fixtures/ocr/anpr_ocr_caso.png`. Para reproducir el caso desde la raíz,
en un entorno que tenga instaladas las dependencias y modelos CPU del servicio:

```powershell
services/anpr/.venv/Scripts/python.exe services/anpr/scripts/evaluar_ocr_selectivo.py --manifest docs/resultados/ocr_selectivo_desarrollo.csv --imagenes services/anpr/tests/fixtures/ocr --salida resultado_ocr_desarrollo.json --hilos 2 --sin-rectificador-aprendido
```

Las 22 etiquetas vacías del benchmark anterior no se deben convertir en negativos: incluyen
recortes truncados u ocluidos y necesitan una anotación explícita antes de usarse para ese fin.

## 3. Diseño que se debe evaluar

### 3.1 Conservar evidencia y separar puntuaciones

La representación de cada lectura debe conservar, como mínimo, el texto crudo por lector, la
confianza visual original, las sustituciones de caracteres, la compatibilidad de formato y la
decisión de aceptación o abstención con sus motivos. El resultado interpretado no reemplaza
la salida cruda.

La compatibilidad sintáctica sirve para ordenar hipótesis o detectar errores de formato. No
debe incrementar por sí sola la confianza visual ni transformar una coincidencia con lista
blanca en prueba de identidad. Una coincidencia entre transformaciones de la misma imagen
tampoco equivale a observaciones independientes.

FastPlateOCR ofrece resultados por carácter y ejecución CPU explícita [5]. Esa información
es útil para estudiar incertidumbre, pero una probabilidad alta entre los caracteres del
vocabulario del modelo no es un certificado de que el recorte contenga una matrícula real.

### 3.2 Verificación selectiva y texto general

Se propone conservar el OCR especializado rápido y usar la evidencia ya disponible del
verificador general para detectar contradicciones. Cuando el lector general identifica texto
no compatible con matrícula y la lectura especializada depende de correcciones sintácticas,
el sistema debe poder abstenerse de publicar una matrícula y conservar la observación textual.

La regla debe explicarse mediante evidencia y probarse con negativos difíciles. No debe ser
una lista de palabras prohibidas como `HAVAL` o `AMBACAR`: ese arreglo memorizaría la imagen
y fallaría con otro concesionario. Tampoco basta con rechazar todos los textos sin dígitos,
pues el lector puede omitir dígitos en una matrícula real. Una abstención prudente no debe
eliminar el paso del vehículo ni sus fotos; debe permitir revisión posterior.

El trabajo sobre incertidumbre específica de LPR [1] y la predicción con opción de rechazo [2]
respaldan evaluar esta decisión. Una compuerta heurística de este sistema no es, por ese solo
hecho, una implementación entrenada de SelectiveNet.

### 3.3 Evidencia temporal con costo acotado

Las lecturas concordantes deben proceder de cuadros fuente distintos del mismo vehículo.
Conviene seleccionar recortes por legibilidad, tamaño y nitidez y limitar la cantidad de
inferencias adicionales por track y su presupuesto de tiempo. Rotar o realzar varias veces un
mismo recorte puede estudiar estabilidad, pero no crea nuevas observaciones del vehículo.

La fusión temporal ya está estudiada; MF-LPR² [3] agrega cuadros alineados y discute los riesgos
de restauraciones que introducen contenido no observado. Ese antecedente no demuestra que
su arquitectura completa cumpla el presupuesto de esta CPU. Se debe medir primero el costo
de la selección y el consenso existentes antes de incorporar una restauración más pesada.

No se propone usar superresolución generativa para inventar detalles de caracteres. Cuando la
información no esté presente, la salida correcta puede seguir siendo una abstención.

### 3.4 Optimización de inferencia CPU

Primero se deben registrar el proveedor real, los hilos y la contención con detector, OCR,
backend y reproducción. ONNX Runtime permite optimización de grafos y cuantización, pero
documenta que INT8 no siempre mejora el rendimiento y puede degradar exactitud [7].

Una variante OpenVINO/NNCF con control de exactitud [8] necesita datos de calibración,
validación y una métrica definida. Debe compararse con FP32 sobre las mismas entradas. Su
calibración interna no sustituye el conjunto final de prueba.

Las latencias publicadas en el Model Zoo de FastPlateOCR se obtuvieron con RTX 3090 y
proveedores TensorRT/CUDA [6]. No deben copiarse como latencias CPU de este sistema.

## 4. Protocolo para el artículo

### 4.1 Datos y verdad de referencia

El conjunto debe incluir matrículas ecuatorianas legibles de auto y moto, matrículas ilegibles
y negativos difíciles: rótulos de concesionario, marcas, anuncios, marcos, rejillas, pantallas,
placas decorativas y recortes parciales. Las etiquetas deben distinguir matrícula real y
legible, matrícula presente pero ilegible, y región sin matrícula. El texto general puede tener
una transcripción separada para evaluar las observaciones.

Dos anotadores deben revisar los casos ambiguos y resolver desacuerdos sin ver la salida de
la variante propuesta. No se inventa una matrícula objetivo para un vehículo sin ella. La
imagen del caso pertenece al desarrollo del método; no puede presentarse después como una
prueba independiente de generalización.

Separar entrenamiento, desarrollo/calibración y prueba por **vehículo y clip completo**. Los
cuadros vecinos, recortes o transformaciones de un mismo paso no pueden caer en particiones
distintas. Cuando existan varias cámaras y jornadas, reservar también escenarios no vistos.
El estudio de generalización entre datasets [4] justifica no limitar la evaluación a una
partición aleatoria de recortes visualmente parecidos.

Los umbrales, presupuesto de tiempo, pesos, elección de modelos y calibración de confianza
se fijan únicamente con entrenamiento/desarrollo. La prueba se evalúa una vez congelada la
configuración. Si se ajusta algo tras observarla, esa prueba pasa a ser desarrollo y se necesita
otra evaluación independiente.

### 4.2 Ablaciones predefinidas

La siguiente tabla es un plan experimental, no una declaración de resultados ni de que todas
las variantes estén ya implementadas.

| Variante | Cambio respecto a la anterior | Pregunta |
|---|---|---|
| B0 | Versión anterior congelada con modelos, reglas y configuración reales | ¿Cuál era la línea base completa? |
| B1 | Separación de confianza visual y puntuación de formato | ¿Cuánto del error dependía de la elevación sintáctica de confianza? |
| B2 | B1 más compuerta de evidencia/contradicción y conservación de texto general | ¿Disminuyen las falsas matrículas sin perder demasiadas lecturas válidas? |
| B3 | B2 más selección y consenso de cuadros fuente distintos con presupuesto fijo | ¿La evidencia temporal mejora el compromiso error/cobertura dentro del presupuesto CPU? |
| C0/C1 | Misma variante y entradas, comparando ONNX FP32 con optimización CPU candidata | ¿La optimización acelera sin una pérdida de reconocimiento inaceptable? |

No cambiar detector, entrenamiento, preprocesamiento y umbrales a la vez y atribuir el cambio
total a la compuerta. Si un componente no puede desactivarse de forma aislada, explicar esa
limitación y no presentar su contribución como identificada causalmente.

### 4.3 Métricas y denominadores

- **Exactitud de matrícula completa:** coincidencia exacta con la etiqueta en pasos con
  matrícula legible. Informar tanto la exactitud sobre todos esos pasos —las abstenciones
  cuentan como no reconocidos— como sobre los pasos aceptados.
- **CER:** suma de distancias de edición dividida por el total de caracteres de las etiquetas
  de matrícula legible. Declarar la normalización de guiones/espacios y publicar las salidas
  crudas además de las interpretadas. No calcular CER de matrícula sobre negativos con
  etiqueta vacía; su denominador no existe.
- **Falsas matrículas en negativos:** negativos a los que se asignó una matrícula divididos
  por todos los negativos. Informar por recorte y, principalmente, por paso completo; muchos
  cuadros del mismo rótulo no equivalen a muchos vehículos independientes.
- **Cobertura y riesgo selectivo:** proporción de casos aceptados y tasa de error entre los
  aceptados al variar el umbral. Mostrar la curva, con definición explícita de si la población
  incluye negativos, y los puntos operativos fijados en desarrollo [2]. Una exactitud alta
  obtenida rechazando casi todo debe quedar visible.
- **Latencia:** p50 y p95 por etapa y de captura a resultado, con número de muestras. Separar
  arranque/carga de modelos, calentamiento e inferencia estable. No comparar tiempo de OCR
  de un recorte con tiempo de punta a punta de otra variante.
- **Recursos y servicio:** CPU, RAM máxima, hilos por biblioteca/proceso, FPS capturados y
  analizados, cuadros descartados, profundidad de cola y vencimientos del presupuesto.
  Informar sistema operativo, procesador, RAM, proveedor de inferencia y contenedores activos.
- **Texto de observación:** coincidencia o CER de texto general en el subconjunto etiquetado
  para esa tarea. Informarlo por separado de exactitud de matrícula.

Publicar tamaños de cada subconjunto y resultados por condición de iluminación, ángulo,
tamaño y tipo de placa. Para proporciones, acompañar los conteos con intervalos de confianza;
para comparaciones, remuestrear por vehículo/clip, no por cuadros correlacionados. Una prueba
unitaria que bloquea esta imagen no estima la tasa de falsos positivos del despliegue.

### 4.4 Reproducibilidad y herramientas existentes

El repositorio contiene `services/anpr/scripts/benchmark_ocr.py` para comparar OCR sobre
recortes y `services/anpr/scripts/evaluar_secuencias.py` para la evaluación de punta a punta
con un backend registrador de prueba. La primera herramienta excluye del cálculo las
etiquetas de placa vacías; por sí sola no mide falsos positivos de rótulos. Hace falta una
evaluación explícita de negativos y abstenciones.

La auditoría de los manifiestos disponibles durante este trabajo encontró limitaciones
concretas que impiden tratarlos como prueba de generalización:

| Manifiesto | Composición auditada | Limitación |
|---|---|---|
| `scripts/benchmark_labels.csv` | 99 filas: 77 positivas de solo dos matrículas y 22 con matrícula vacía | Ninguna de las 99 imágenes referenciadas existe hoy en las rutas esperadas; las etiquetas vacías además eran excluidas por el benchmark anterior. |
| OCR, entrenamiento | 7.560 muestras: 6.000 sintéticas y 1.560 reales | Las reales corresponden a 20 repeticiones de 78 rutas de una sola matrícula. Repetir una entrada no aumenta la diversidad de vehículos. |
| OCR, validación | 1.010 muestras: 1.000 sintéticas y 10 reales | Las reales muestran la misma matrícula que las reales de entrenamiento. |

No se detectaron rutas idénticas compartidas entre entrenamiento y validación en esa
auditoría, pero sí identidad de matrícula compartida. Una separación de nombres de archivo
no evita esta fuga de identidad. Con ese conjunto no se puede estimar reconocimiento de
matrículas reales nuevas ni atribuir generalización a un modelo afinado. Hace falta reunir y
anotar una prueba independiente por vehículo/clip antes de publicar tales conclusiones.
Esta auditoría no modifica, mueve ni elimina los datos existentes.

También existen `app/aplicacion/verificacion_placa.py`, `app/dominio/interpretacion_placa.py`,
`app/aplicacion/plate_agent.py` y `app/infraestructura/ocr_verifier.py`. Se debe documentar qué
etapas se activaron realmente en cada ejecución, no deducirlo de sus nombres o comentarios.

Guardar versión de dependencias, hashes de modelos, manifiesto de entradas y particiones,
semillas, configuración, comandos, proveedor y hardware. Como el árbol de trabajo puede
contener cambios sin confirmar, el SHA de Git por sí solo no describe el experimento: guardar
también el parche o una copia identificable del código ejecutado.

Las cifras de documentos previos —incluidos `docs/METODO_VERIFICACION_LECTURA.md`,
`docs/EXPERIMENTO_MODELOS.md` y archivos antiguos de `docs/resultados/`— son antecedentes.
No se consideran verificadas para esta variante hasta reproducirlas con sus datos, pesos y
configuración originales. No se han usado como nuevos resultados en este documento.

## 5. Alcance de una contribución publicable

Una posible contribución es evaluar un sistema de ANPR selectivo y auditable sobre datos
ecuatorianos y negativos difíciles, con un presupuesto CPU explícito. La contribución debe
enunciarse después de medir qué mecanismo aporta una mejora y bajo qué condiciones.

La combinación de geometría, OCR, consenso y abstención tiene antecedentes. Este documento
no acredita que sea una combinación inédita ni que sus componentes constituyan un método
nuevo. La evaluación independiente, las ablaciones, la reproducibilidad y la discusión de
fallos son necesarias incluso si el caso del concesionario queda resuelto.

## 6. Fuentes primarias

Consulta de las ocho fuentes: **2026-10-27**. Sus resultados publicados no se trasladan como
resultados de este equipo.

1. Schirrmacher, F.; Lorch, B.; Maier, A.; Riess, C. (2023).
   [Benchmarking Probabilistic Deep Learning Methods for License Plate Recognition](https://arxiv.org/abs/2302.01427).
   Incertidumbre y detección de predicciones erróneas de LPR bajo degradación y distribución
   distinta. No valida por sí mismo el rechazo de rótulos ecuatorianos.
2. Geifman, Y.; El-Yaniv, R. (2019).
   [SelectiveNet: A Deep Neural Network with an Integrated Reject Option](https://proceedings.mlr.press/v97/geifman19a.html).
   ICML, PMLR 97:2151–2159. Fundamenta la evaluación riesgo–cobertura; su arquitectura
   entrenada no equivale a añadir un umbral heurístico.
3. Na, K. et al. (2025).
   [MF-LPR²: Multi-Frame License Plate Image Restoration and Recognition using Optical Flow](https://arxiv.org/abs/2508.14797).
   CVIU, 256, 104361. Agregación de evidencia de varios cuadros y límites de la restauración
   generativa. No acredita la latencia de su arquitectura en esta CPU.
4. Laroca, R.; Cardoso, E. V.; Lucio, D. R.; Estevam, V.; Menotti, D. (2022).
   [On the Cross-dataset Generalization in License Plate Recognition](https://arxiv.org/abs/2201.00267).
   VISAPP. Sustenta evaluar distribución distinta y no confiar solo en particiones del mismo
   dataset.
5. FastPlateOCR, documentación oficial.
   [LicensePlateRecognizer](https://ankandrew.github.io/fast-plate-ocr/latest/reference/inference/inference_class/).
   API ONNX Runtime, selección CPU, formato de imagen y confianza por carácter.
6. FastPlateOCR, documentación oficial.
   [Available Models](https://ankandrew.github.io/fast-plate-ocr/latest/inference/model_zoo/).
   El entorno del benchmark publicado usa RTX 3090 y proveedores GPU; no es una medición CPU.
7. Microsoft ONNX Runtime, documentación oficial.
   [Quantize ONNX models](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html).
   Calibración, formatos y depuración de cuantización. Advierte sobre pérdida de precisión y
   posibles regresiones de rendimiento según modelo/hardware.
8. OpenVINO, documentación oficial 2025.
   [Quantizing with Accuracy Control](https://docs.openvino.ai/2025/openvino-workflow/model-optimization-guide/quantizing-models-post-training/quantizing-with-accuracy-control.html).
   Control de la caída de una métrica durante PTQ con NNCF, usando validación y conservando
   operaciones sensibles en mayor precisión.
