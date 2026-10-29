"""Evaluación de recortes OCR con negativos explícitos y abstención.

Manifest CSV: archivo,placa,tipo,texto_observado,grupo. ``tipo`` es ``placa``
(matrícula legible y etiqueta obligatoria) o ``texto`` (rótulo sin matrícula,
etiqueta de placa vacía). ``texto_observado`` es una anotación de referencia:
NUNCA se entrega al selector. Las imágenes se resuelven bajo --imagenes.

Ejemplo desde services/anpr, tras copiar el caso de desarrollo a /tmp:
 python scripts/evaluar_ocr_selectivo.py --manifest ../../docs/resultados/ocr_selectivo_desarrollo.csv \
   --imagenes /tmp --salida /tmp/ocr_selectivo.json --hilos 2

No abre cámaras, entrena modelos, consulta listas ni envía resultados al backend.
Evalúa recortes, no decisiones de acceso ni secuencias. Las latencias excluyen
carga/calentamiento y son secuenciales (agente + verificador); no equivalen a la
latencia del motor en paralelo. Un manifest de desarrollo no prueba generalización.
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import math
import os
from pathlib import Path
import platform
import random
import re
import sys
import time
from typing import Iterable

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))


def normalizar(texto: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (texto or "").upper())


def distancia(a: str, b: str) -> int:
    anterior = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        actual = [i]
        for j, cb in enumerate(b, 1):
            actual.append(min(actual[-1] + 1, anterior[j] + 1, anterior[j - 1] + (ca != cb)))
        anterior = actual
    return anterior[-1]


def percentil(valores: Iterable[float], q: float) -> float | None:
    datos = sorted(valores)
    if not datos:
        return None
    posicion = (len(datos) - 1) * q
    base = int(posicion)
    return datos[base] + (datos[min(base + 1, len(datos) - 1)] - datos[base]) * (posicion - base)


def sha256(ruta: Path) -> str:
    h = hashlib.sha256()
    with ruta.open("rb") as archivo:
        for bloque in iter(lambda: archivo.read(1024 * 1024), b""):
            h.update(bloque)
    return h.hexdigest()


@dataclass(frozen=True)
class Caso:
    archivo: str
    placa: str
    tipo: str
    texto_observado: str = ""
    grupo: str = ""


@dataclass(frozen=True)
class Prediccion:
    propuesta: str
    aceptada: bool
    latencia_ms: float
    texto_crudo: str = ""
    texto_observado: str = ""
    confianza_texto: float = 0.0
    motivo: str = ""


def leer_manifest(manifest: Path, imagenes: Path) -> list[Caso]:
    raiz = imagenes.resolve()
    casos = []
    vistas: set[Path] = set()
    with manifest.open(encoding="utf-8-sig", newline="") as archivo:
        lector = csv.DictReader(archivo)
        if not {"archivo", "placa", "tipo"}.issubset(lector.fieldnames or []):
            raise ValueError("El manifest requiere archivo, placa y tipo")
        for numero, fila in enumerate(lector, 2):
            nombre = (fila.get("archivo") or "").strip()
            tipo = (fila.get("tipo") or "").strip().lower()
            placa = normalizar(fila.get("placa") or "")
            if not nombre or tipo not in ("placa", "texto"):
                raise ValueError(f"Fila {numero}: archivo o tipo inválido")
            if (tipo == "placa" and not placa) or (tipo == "texto" and placa):
                raise ValueError(f"Fila {numero}: etiqueta contradictoria con tipo {tipo}")
            ruta = (raiz / nombre).resolve()
            if not ruta.is_relative_to(raiz) or not ruta.is_file():
                raise ValueError(f"Fila {numero}: imagen inexistente o fuera de --imagenes")
            if ruta in vistas:
                raise ValueError(f"Fila {numero}: imagen duplicada; no repetir unidades experimentales")
            vistas.add(ruta)
            casos.append(Caso(nombre, placa, tipo, (fila.get("texto_observado") or "").strip(),
                              (fila.get("grupo") or "").strip()))
    if not casos:
        raise ValueError("El manifest no contiene casos")
    return casos


def resumir(casos: list[Caso], predicciones: list[Prediccion], tiempos: list[float] | None = None) -> dict:
    if len(casos) != len(predicciones) or not casos:
        raise ValueError("Se requiere exactamente una predicción por caso")
    positivos = [(c, p) for c, p in zip(casos, predicciones) if c.tipo == "placa"]
    negativos = [(c, p) for c, p in zip(casos, predicciones) if c.tipo == "texto"]
    aceptados = [(c, p) for c, p in zip(casos, predicciones) if p.aceptada]
    if any(p.aceptada and not normalizar(p.propuesta) for p in predicciones):
        raise ValueError("Una salida vacía no puede contarse como aceptada")
    aciertos_brutos = sum(normalizar(p.propuesta) == c.placa for c, p in positivos)
    aciertos_aceptados = sum(p.aceptada and normalizar(p.propuesta) == c.placa for c, p in positivos)
    aceptados_positivos = sum(p.aceptada for _, p in positivos)
    falsos_positivos = sum(p.aceptada for _, p in negativos)
    errores_aceptados = sum(c.tipo == "texto" or normalizar(p.propuesta) != c.placa for c, p in aceptados)
    caracteres = sum(len(c.placa) for c, _ in positivos)
    dividir = lambda n, d: n / d if d else None
    latencias = tiempos if tiempos is not None else [p.latencia_ms for p in predicciones]
    if any(not math.isfinite(t) or t < 0 for t in latencias):
        raise ValueError("Las latencias deben ser finitas y no negativas")
    return {
        "casos": len(casos), "positivos": len(positivos), "negativos": len(negativos),
        "aceptados": len(aceptados), "falsas_aceptaciones_negativos": falsos_positivos,
        "tasa_falsa_aceptacion_negativos": dividir(falsos_positivos, len(negativos)),
        "exactitud_bruta_positivos": dividir(aciertos_brutos, len(positivos)),
        "exactitud_aceptada_positivos": dividir(aciertos_aceptados, len(positivos)),
        "exactitud_condicional_aceptadas_positivos": dividir(aciertos_aceptados, aceptados_positivos),
        "cobertura_positivos": dividir(aceptados_positivos, len(positivos)),
        "cobertura_global": dividir(len(aceptados), len(casos)),
        "riesgo_selectivo_global": dividir(errores_aceptados, len(aceptados)),
        "cer_propuesta_positivos": dividir(sum(distancia(normalizar(p.propuesta), c.placa) for c, p in positivos), caracteres),
        "cer_salida_positivos": dividir(sum(distancia(normalizar(p.propuesta) if p.aceptada else "", c.placa) for c, p in positivos), caracteres),
        "latencia_ms": {"muestras": len(latencias), "p50": percentil(latencias, 0.5), "p95": percentil(latencias, 0.95)},
    }


def inventario_modelos(objetos: Iterable[object], adicionales: Iterable[Path] = ()) -> list[dict]:
    """Identifica pesos/configs realmente referenciados por los adaptadores cargados.

    Solo inspecciona atributos de configuración/sesión; no serializa modelos,
    tensores ni variables de entorno. --modelo permite añadir un archivo explícito.
    """
    rutas = {p.resolve() for p in adicionales if p.is_file()}
    vistos: set[int] = set()
    extensiones = {".onnx", ".xml", ".bin", ".pt", ".yaml", ".yml"}

    def visitar(objeto: object, profundidad: int = 0) -> None:
        if isinstance(objeto, (str, Path)):
            if len(str(objeto)) < 1024 and Path(objeto).suffix.lower() in extensiones:
                ruta = Path(objeto)
                if ruta.is_file():
                    rutas.add(ruta.resolve())
                    if ruta.suffix.lower() == ".xml" and ruta.with_suffix(".bin").is_file():
                        rutas.add(ruta.with_suffix(".bin").resolve())
            return
        if profundidad > 5 or id(objeto) in vistos:
            return
        vistos.add(id(objeto))
        if isinstance(objeto, dict):
            elementos = objeto.items()
        elif hasattr(objeto, "__dict__"):
            elementos = vars(objeto).items()
        else:
            return
        for nombre, valor in elementos:
            if any(t in str(nombre).lower() for t in ("model", "path", "config", "session", "infer", "recogn", "text_", "_ocr")):
                visitar(valor, profundidad + 1)

    for objeto in objetos:
        visitar(objeto)
    return [{"archivo": str(ruta), "sha256": sha256(ruta), "bytes": ruta.stat().st_size} for ruta in sorted(rutas)]


def archivos_verificador(verificador) -> list[Path]:
    """OpenVINO no conserva model_path; reconstruye la ruta con su resolver instalado.

    get_model_url solo consulta el inventario de RapidOCR: no descarga ni reemplaza
    archivos. Se incluyen únicamente las etapas habilitadas para inferencia.
    """
    from rapidocr.inference_engine.base import FileInfo
    motor = verificador._ocr
    rutas = []
    for nombre, seccion in (("det", "Det"), ("rec", "Rec"), ("cls", "Cls")):
        if not getattr(motor, "use_" + nombre, False):
            continue
        cfg = getattr(motor.cfg, seccion)
        ruta = cfg.get("model_path")
        if not ruta:
            sesion = getattr(motor, "text_" + nombre).session
            info = sesion.get_model_url(FileInfo(engine_type=cfg.engine_type, ocr_version=cfg.ocr_version,
                task_type=cfg.task_type, lang_type=cfg.lang_type, model_type=cfg.model_type))
            ruta = Path(cfg.model_root_dir) / Path(info["model_dir"]).name
        ruta = Path(ruta)
        if not ruta.is_file():
            raise ValueError(f"No se pudo inventariar el modelo activo del verificador: {seccion}")
        rutas.append(ruta)
        if ruta.suffix.lower() == ".xml" and ruta.with_suffix(".bin").is_file():
            rutas.append(ruta.with_suffix(".bin"))
    return rutas


def metadatos(hilos: int, semilla: int) -> dict:
    cpu = platform.processor()
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.is_file():
        cpu = next((l.split(":", 1)[1].strip() for l in cpuinfo.read_text().splitlines() if l.startswith("model name")), cpu)
    versiones = {}
    for nombre in ("numpy", "opencv-python", "onnxruntime", "openvino", "rapidocr", "fast-plate-ocr", "ultralytics"):
        try:
            versiones[nombre] = metadata.version(nombre)
        except metadata.PackageNotFoundError:
            versiones[nombre] = None
    cpu_max = Path("/sys/fs/cgroup/cpu.max")
    return {
        "utc": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
        "sistema": platform.platform(), "cpu": cpu, "nucleos_logicos": os.cpu_count(),
        "cpu_cgroup_max": cpu_max.read_text().strip() if cpu_max.is_file() else None,
        "hilos_solicitados_por_motor": hilos, "semilla": semilla, "paquetes": versiones,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--imagenes", required=True, type=Path)
    ap.add_argument("--salida", required=True, type=Path)
    ap.add_argument("--hilos", type=int, default=2)
    ap.add_argument("--semilla", type=int, default=0)
    ap.add_argument("--repeticiones", type=int, default=3)
    ap.add_argument("--calentamiento", type=int, default=2)
    ap.add_argument("--modelo", action="append", type=Path, default=[])
    ap.add_argument("--nota-conjunto", default="", help="Procedencia/limitación del conjunto, conservada en el informe")
    ap.add_argument("--sin-rectificador-aprendido", action="store_true")
    a = ap.parse_args()
    if a.hilos < 1 or a.repeticiones < 1 or a.calentamiento < 0:
        ap.error("hilos/repeticiones deben ser positivos; calentamiento no negativo")
    casos = leer_manifest(a.manifest, a.imagenes)
    if any(not p.is_file() for p in a.modelo):
        ap.error("Cada --modelo debe existir para registrar su hash")
    archivos = [Path(__file__), SERVICE / "app/aplicacion/plate_agent.py", SERVICE / "app/infraestructura/ocr_engine.py",
                SERVICE / "app/infraestructura/ocr_verifier.py", SERVICE / "app/dominio/texto_observado.py", SERVICE / "app/dominio/plate_parser.py"]
    fuentes_iniciales = {p: sha256(p) for p in archivos}
    for clave in ("OCR_THREADS", "OCR_VERIFIER_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
        os.environ[clave] = str(a.hilos)
    random.seed(a.semilla)
    import cv2
    import numpy as np
    import torch
    from app.aplicacion.plate_agent import PlateEnhancementAgent
    from app.dominio.texto_observado import es_texto_no_matricula
    from app.infraestructura.ocr_verifier import PlateOcrVerifier
    from app.infraestructura import config
    cv2.setNumThreads(a.hilos)
    torch.set_num_threads(a.hilos)
    torch.manual_seed(a.semilla)
    np.random.seed(a.semilla)
    imagenes = []
    for caso in casos:
        img = cv2.imread(str((a.imagenes / caso.archivo).resolve()))
        if img is None:
            raise ValueError(f"Imagen no decodificable: {caso.archivo}")
        imagenes.append(img)
    inicio = time.perf_counter()
    agente = PlateEnhancementAgent(use_learned_rectifier=not a.sin_rectificador_aprendido)
    verificador = PlateOcrVerifier()
    carga_ms = (time.perf_counter() - inicio) * 1000

    def ejecutar(imagen) -> tuple[Prediccion, Prediccion, Prediccion]:
        alto, ancho = imagen.shape[:2]
        t0 = time.perf_counter()
        base = agente.process_image(imagen, [0, 0, ancho, alto], fast_mode=False)
        ms_base = (time.perf_counter() - t0) * 1000
        lectura = verificador.read(imagen)
        ms_sin_veto = (time.perf_counter() - t0) * 1000
        placa_base = normalizar(base.placa)
        acepta_base = bool(placa_base and base.estado == "procesado")
        observada = lectura.texto_observado
        confianza = lectura.confianza_texto
        rotulo = lectura.within_budget and es_texto_no_matricula(observada, confianza, lectura.plate)
        propuesta = normalizar(lectura.plate) if lectura.within_budget and lectura.plate else placa_base
        acepta_sin_veto = bool(propuesta and (lectura.within_budget and lectura.plate or acepta_base))
        acepta = acepta_sin_veto and not rotulo
        ms_total = (time.perf_counter() - t0) * 1000
        motivo = "verificador" if lectura.within_budget and lectura.plate else "agente_sin_confirmacion"
        return (
            Prediccion(placa_base, acepta_base, ms_base, base.texto_crudo, motivo=base.estado),
            Prediccion(propuesta, acepta_sin_veto, ms_sin_veto, base.texto_crudo, observada, confianza, motivo),
            Prediccion(propuesta, acepta, ms_total, base.texto_crudo, observada, confianza,
                       "texto_no_matricula" if rotulo else motivo),
        )

    for _ in range(a.calentamiento):
        ejecutar(imagenes[0])
    resultados: dict[str, list[Prediccion]] = {"agente_actual": [], "agente_mas_verificador_sin_veto": [], "selector_texto_observado": []}
    tiempos: dict[str, list[float]] = {nombre: [] for nombre in resultados}
    detalle = []
    for caso, imagen in zip(casos, imagenes):
        corridas = [ejecutar(imagen) for _ in range(a.repeticiones)]
        fila = {"caso": asdict(caso), "imagen_sha256": sha256(a.imagenes / caso.archivo), "metodos": {}}
        for i, nombre in enumerate(resultados):
            predicciones = [corrida[i] for corrida in corridas]
            prediccion = predicciones[0]  # la repetición no multiplica unidades de exactitud
            resultados[nombre].append(prediccion)
            tiempos[nombre].extend(p.latencia_ms for p in predicciones)
            fila["metodos"][nombre] = {**asdict(prediccion), "latencias_ms": [p.latencia_ms for p in predicciones],
                "prediccion_estable": all((p.propuesta, p.aceptada) == (prediccion.propuesta, prediccion.aceptada) for p in predicciones)}
        detalle.append(fila)
    if any(sha256(p) != huella for p, huella in fuentes_iniciales.items()):
        raise RuntimeError("Las fuentes cambiaron durante la medición; repetir para conservar procedencia")
    rectificador = Path(config.PLATE_RECTIFIER_PATH)
    if not rectificador.is_absolute():
        rectificador = SERVICE / rectificador
    adicionales = [*a.modelo, rectificador, *archivos_verificador(verificador)]
    informe = {
        "protocolo": {"unidad": "recorte", "nota_conjunto": a.nota_conjunto, "latencia": "secuencial; excluye carga y calentamiento",
            "ablacion": "agente_mas_verificador_sin_veto vs selector_texto_observado aísla la regla nueva; ambos comparten las mismas inferencias.",
            "repeticiones_tiempo_por_recorte": a.repeticiones, "calentamientos": a.calentamiento,
            "anotacion_texto_usada_para_decidir": False, "rectificador_aprendido_habilitado": not a.sin_rectificador_aprendido,
            "limitaciones": ["No mide autorización, detector, consenso temporal ni latencia de evento completo.",
                "El selector de recortes no sustituye las evidencias E1–E5 del motor.",
                "Sin positivos o negativos, su métrica es null; un único caso no demuestra generalización.",
                "No se controla carga concurrente del equipo: registrar otras cargas antes de comparar tiempos."]},
        "entorno": metadatos(a.hilos, a.semilla), "carga_modelos_ms": carga_ms,
        "manifest": {"archivo": str(a.manifest), "sha256": sha256(a.manifest)},
        "fuentes": [{"archivo": str(p.relative_to(SERVICE)) if p.is_relative_to(SERVICE) else str(p), "sha256": fuentes_iniciales[p]} for p in archivos],
        "modelos": inventario_modelos([agente, verificador], adicionales),
        "metricas": {nombre: resumir(casos, preds, tiempos[nombre]) for nombre, preds in resultados.items()},
        "predicciones": detalle,
    }
    a.salida.parent.mkdir(parents=True, exist_ok=True)
    a.salida.write_text(json.dumps(informe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"salida": str(a.salida), "metricas": informe["metricas"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
