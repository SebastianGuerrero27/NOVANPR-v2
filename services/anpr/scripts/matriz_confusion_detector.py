"""
Matriz de confusión por placa de uno o varios detectores, con el protocolo de
docs/resultados/matriz_confusion_yolo26n_produccion.svg (IoU >= 0.5, asignación voraz por confianza,
la misma de scripts/evaluate_detectors.py).

  - VP: placa etiquetada cubierta por una predicción con confianza >= umbral e IoU >= 0.5.
  - FN: placa etiquetada sin predicción que la cubra (VP + FN = placas etiquetadas).
  - FP: predicción con confianza >= umbral que no cubre ninguna placa libre.
  - VN: no aplica en detección de objetos (no hay un número acotado de "regiones sin placa").

Cada modelo se compara con el primero mediante McNemar por placa (solo cuentan las placas que uno
detecta y el otro no), con corrección de continuidad.

Uso (desde services/anpr):
    python scripts/matriz_confusion_detector.py evaluar --data-dir ../../dataset/openimages_plates \
        --models produccion=models/license_plate_detector.pt candidato=models/<candidato>.pt \
        --out ../../docs/resultados/matriz_confusion_<fecha>.json
    python scripts/matriz_confusion_detector.py svg --json ../../docs/resultados/matriz_confusion_<fecha>.json \
        --modelo candidato --umbral 0.35 --out ../../docs/resultados/matriz_confusion_<modelo>.svg
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from pathlib import Path
from xml.sax.saxutils import escape

import cv2
import numpy as np

TRAMOS_ANCHO = [(0, 16), (16, 32), (32, 64), (64, 128), (128, 10**9)]


def iou(a, b) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def cargar(data_dir: Path, split: str):
    items = []
    for img_path in sorted((data_dir / "images" / split).glob("*")):
        if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        img = cv2.imread(str(img_path))
        h, w = img.shape[:2]
        reales = []
        etiqueta = data_dir / "labels" / split / f"{img_path.stem}.txt"
        for linea in (etiqueta.read_text(encoding="utf-8").splitlines() if etiqueta.exists() else []):
            partes = linea.split()
            if len(partes) == 5:
                _, cx, cy, bw, bh = map(float, partes)
                reales.append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
        items.append((img_path.stem, img, reales))
    return items


def emparejar(preds, reales):
    """Asignación voraz por confianza descendente: (conf, acierto, iou) por predicción y la
    confianza con que se detectó cada placa (None si ninguna predicción la cubre)."""
    usadas: set[int] = set()
    detectada: list[float | None] = [None] * len(reales)
    filas = []
    for caja, conf in sorted(preds, key=lambda p: -p[1]):
        mejor_j, mejor_iou = -1, 0.0
        for j, g in enumerate(reales):
            v = iou(caja, g)
            if j not in usadas and v > mejor_iou:
                mejor_j, mejor_iou = j, v
        acierto = mejor_iou >= 0.5
        if acierto:
            usadas.add(mejor_j)
            detectada[mejor_j] = conf
        filas.append((conf, acierto, mejor_iou))
    return filas, detectada


def average_precision(puntuadas: list[tuple[float, bool]], n_gt: int) -> float:
    if n_gt == 0:
        return 0.0
    puntuadas = sorted(puntuadas, key=lambda x: -x[0])
    tp = np.cumsum([s[1] for s in puntuadas])
    fp = np.cumsum([not s[1] for s in puntuadas])
    rec = tp / n_gt
    prec = tp / np.maximum(tp + fp, 1e-9)
    mrec = np.concatenate([[0], rec, [1]])
    mpre = np.concatenate([[1], prec, [0]])
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def mcnemar(a: list[bool], b: list[bool]) -> dict:
    n10 = sum(x and not y for x, y in zip(a, b))
    n01 = sum(y and not x for x, y in zip(a, b))
    chi2 = (abs(n10 - n01) - 1) ** 2 / (n10 + n01) if n10 + n01 else 0.0
    return {"solo_referencia": n10, "solo_modelo": n01,
            "ambos": sum(x and y for x, y in zip(a, b)),
            "ninguno": sum(not x and not y for x, y in zip(a, b)),
            "chi2": round(chi2, 2), "p": math.erfc(math.sqrt(chi2 / 2)) if chi2 > 0 else 1.0}


def evaluar(args) -> None:
    import torch
    from ultralytics import YOLO

    torch.set_num_threads(args.threads)
    data_dir = Path(args.data_dir).resolve()
    items = cargar(data_dir, args.split)
    n_gt = sum(len(r) for _, _, r in items)
    print(f"{data_dir} [{args.split}]: {len(items)} imágenes, {n_gt} placas", flush=True)
    resultados, aciertos = {}, {}
    for spec in args.models:
        nombre, ruta = spec.split("=", 1)
        modelo = YOLO(ruta)
        modelo.predict(items[0][1], conf=0.01, imgsz=args.imgsz, verbose=False, device="cpu")
        puntuadas, confs_placa, anchos, t_total = [], [], [], 0.0
        for _, img, reales in items:
            anchos += [g[2] - g[0] for g in reales]
            t0 = time.perf_counter()
            r = modelo.predict(img, conf=0.01, imgsz=args.imgsz, verbose=False, device="cpu")[0]
            t_total += time.perf_counter() - t0
            preds = [(list(map(float, b)), float(c)) for b, c in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy())]
            filas, detectada = emparejar(preds, reales)
            puntuadas += filas
            confs_placa += detectada
        por_umbral = {}
        for u in args.umbrales:
            vp = sum(1 for c in confs_placa if c is not None and c >= u)
            fp = sum(1 for c, ok, _ in puntuadas if c >= u and not ok)
            fn = n_gt - vp
            p = vp / max(1, vp + fp)
            rec = vp / max(1, n_gt)
            ious = [v for c, ok, v in puntuadas if c >= u and ok]
            # Recall por ancho de la placa etiquetada (px de la imagen evaluada): ubica los FN
            por_tamano = {}
            for lo, hi in TRAMOS_ANCHO:
                idx = [i for i, a in enumerate(anchos) if lo <= a < hi]
                det = sum(1 for i in idx if confs_placa[i] is not None and confs_placa[i] >= u)
                por_tamano[f"{lo}-{hi if hi < 1e9 else 'inf'}"] = {"placas": len(idx), "vp": det,
                                                                   "recall": det / len(idx) if idx else None}
            por_umbral[f"{u:g}"] = {"vp": vp, "fn": fn, "fp": fp, "precision": p, "recall": rec,
                                    "f1": 2 * p * rec / max(1e-9, p + rec),
                                    "iou_medio": float(np.mean(ious)) if ious else 0.0,
                                    "recall_por_ancho_px": por_tamano}
            aciertos[(nombre, u)] = [c is not None and c >= u for c in confs_placa]
        resultados[nombre] = {
            "ruta": ruta, "sha256": hashlib.sha256(Path(ruta).read_bytes()).hexdigest(),
            "ap50": average_precision([(c, ok) for c, ok, _ in puntuadas], n_gt),
            "ms_por_imagen": t_total / len(items) * 1000, "umbrales": por_umbral,
        }
        resumen = "  ".join(f"@{k}: VP {v['vp']} FN {v['fn']} FP {v['fp']} P {v['precision']:.3f} R {v['recall']:.3f}"
                            for k, v in por_umbral.items())
        print(f"{nombre:14s} AP50 {resultados[nombre]['ap50']:.4f}  {resumen}", flush=True)
    referencia = args.models[0].split("=", 1)[0]
    for nombre in resultados:
        if nombre != referencia:
            resultados[nombre]["mcnemar_vs_" + referencia] = {
                f"{u:g}": mcnemar(aciertos[(referencia, u)], aciertos[(nombre, u)]) for u in args.umbrales}
    salida = {"fecha": time.strftime("%Y-%m-%d"), "dataset": args.descripcion or str(data_dir),
              "split": args.split, "imgsz": args.imgsz, "iou": 0.5, "imagenes": len(items), "placas": n_gt,
              "protocolo": "Asignación voraz por confianza (scripts/evaluate_detectors.py); VP+FN = placas etiquetadas; "
                           "VN no aplica en detección de objetos.",
              "torch_threads": args.threads, "modelos": resultados}
    Path(args.out).write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Guardado en {args.out}")


def miles(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def pct(x: float) -> str:
    return f"{x * 100:.1f}".replace(".", ",") + " %"


def svg(args) -> None:
    datos = json.loads(Path(args.json).read_text(encoding="utf-8"))
    m = datos["modelos"][args.modelo]["umbrales"][f"{args.umbral:g}"]
    u = f"{args.umbral:.2f}".replace(".", ",")
    titulo = escape(args.titulo)
    subtitulo = escape(args.subtitulo)
    conjunto = f"{miles(datos['imagenes'])} imágenes · {miles(datos['placas'])} placas reales · confianza ≥ {u} · IoU ≥ 0,50"
    nota = [escape(t) for t in args.nota] or [
        f"Fuente: {Path(args.json).name} (scripts/matriz_confusion_detector.py), confianza {u} e IoU ≥ 0,50.",
        "Los conteos se refieren a placas/regiones, no a imágenes."]
    lectura = [escape(t) for t in args.lectura] or [
        f"El umbral {u} es el de la matriz anterior,", "para comparar ambas; el servicio opera", "con el umbral de su .env."]
    vp, fn, fp = m["vp"], m["fn"], m["fp"]
    desc = (f"Evaluación por placa: {vp} verdaderos positivos, {fn} falsos negativos y {fp} falsos positivos. "
            "La celda fondo-fondo no aplica a detección de objetos.")
    lineas_lectura = "\n".join(f'  <text x="930" y="{550 + 30 * i}" class="detail">{t}</text>' for i, t in enumerate(lectura))
    lineas_nota = "\n".join(f'  <text x="700" y="{875 + 27 * i}" text-anchor="middle" class="note">{t}</text>'
                            for i, t in enumerate(nota))
    contenido = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="960" viewBox="0 0 1400 960" role="img" aria-labelledby="title description">
  <title id="title">{titulo}</title>
  <desc id="description">{escape(desc)}</desc>
  <defs>
    <style>
      text {{ font-family: Arial, Helvetica, sans-serif; fill: #172033; }}
      .title {{ font-size: 36px; font-weight: 700; }}
      .subtitle {{ font-size: 21px; fill: #475569; }}
      .axis {{ font-size: 21px; font-weight: 700; }}
      .header {{ font-size: 19px; font-weight: 700; fill: #ffffff; }}
      .rowheader {{ font-size: 19px; font-weight: 700; }}
      .count {{ font-size: 36px; font-weight: 700; }}
      .name {{ font-size: 20px; font-weight: 700; }}
      .detail {{ font-size: 17px; fill: #334155; }}
      .note {{ font-size: 16px; fill: #475569; }}
    </style>
  </defs>

  <rect width="1400" height="960" fill="#ffffff"/>
  <text x="700" y="70" text-anchor="middle" class="title">{titulo}</text>
  <text x="700" y="108" text-anchor="middle" class="subtitle">{subtitulo}</text>
  <text x="700" y="140" text-anchor="middle" class="subtitle">{escape(conjunto)}</text>

  <text x="875" y="194" text-anchor="middle" class="axis">Clase predicha</text>
  <rect x="280" y="210" width="270" height="48" rx="8" fill="#334155"/>
  <rect x="560" y="210" width="270" height="48" rx="8" fill="#334155"/>
  <text x="416" y="234" text-anchor="middle" class="header">Placa detectada</text>
  <text x="687" y="234" text-anchor="middle" class="header">Fondo (sin detección)</text>

  <text x="180" y="290" text-anchor="middle" class="axis">Clase</text>
  <text x="180" y="319" text-anchor="middle" class="axis">real</text>

  <rect x="280" y="270" width="270" height="270" rx="12" fill="#d1fae5" stroke="#94a3b8" stroke-width="2"/>
  <rect x="560" y="270" width="270" height="270" rx="12" fill="#fee2e2" stroke="#94a3b8" stroke-width="2"/>
  <rect x="280" y="550" width="270" height="220" rx="12" fill="#ffedd5" stroke="#94a3b8" stroke-width="2"/>
  <rect x="560" y="550" width="270" height="220" rx="12" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>

  <text x="180" y="392" text-anchor="middle" class="rowheader">Placa</text>
  <text x="180" y="650" text-anchor="middle" class="rowheader">Fondo</text>

  <text x="415" y="350" text-anchor="middle" class="count">{miles(vp)}</text>
  <text x="415" y="389" text-anchor="middle" class="name">Verdaderos positivos (VP)</text>
  <text x="415" y="425" text-anchor="middle" class="detail">Placas reales detectadas</text>
  <text x="415" y="461" text-anchor="middle" class="detail">Recall: {pct(m['recall'])}</text>

  <text x="695" y="350" text-anchor="middle" class="count">{miles(fn)}</text>
  <text x="695" y="389" text-anchor="middle" class="name">Falsos negativos (FN)</text>
  <text x="695" y="425" text-anchor="middle" class="detail">Placas reales no detectadas</text>

  <text x="415" y="620" text-anchor="middle" class="count">{miles(fp)}</text>
  <text x="415" y="659" text-anchor="middle" class="name">Falsos positivos (FP)</text>
  <text x="415" y="695" text-anchor="middle" class="detail">Regiones sin placa detectadas</text>
  <text x="415" y="731" text-anchor="middle" class="detail">Precisión: {pct(m['precision'])}</text>

  <text x="695" y="640" text-anchor="middle" class="count">N/A</text>
  <text x="695" y="679" text-anchor="middle" class="name">No aplicable</text>
  <text x="695" y="715" text-anchor="middle" class="detail">No existe un número acotado</text>
  <text x="695" y="741" text-anchor="middle" class="detail">de verdaderos negativos</text>

  <rect x="890" y="270" width="420" height="500" rx="14" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/>
  <text x="930" y="318" class="name">Cómo leer la evaluación</text>
  <text x="930" y="362" class="detail">• {miles(datos['placas'])} placas anotadas como verdad terreno.</text>
  <text x="930" y="404" class="detail">• VP + FN = {miles(datos['placas'])} placas reales.</text>
  <text x="930" y="446" class="detail">• Precisión = VP / (VP + FP).</text>
  <text x="930" y="488" class="detail">• Recall = VP / (VP + FN).</text>
{lineas_lectura}
  <text x="930" y="676" class="detail">La matriz cuenta objetos emparejados con</text>
  <text x="930" y="706" class="detail">IoU ≥ 0,50, no píxeles de la imagen.</text>

  <line x1="90" y1="835" x2="1310" y2="835" stroke="#cbd5e1" stroke-width="2"/>
{lineas_nota}
</svg>
"""
    Path(args.out).write_text(contenido, encoding="utf-8")
    print(f"SVG guardado en {args.out}: VP {vp} · FN {fn} · FP {fp}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="modo", required=True)
    ev = sub.add_parser("evaluar", help="Evaluar detectores y guardar los conteos en JSON")
    ev.add_argument("--data-dir", required=True, help="Dataset YOLO (images/<split>, labels/<split>)")
    ev.add_argument("--split", default="test")
    ev.add_argument("--models", nargs="+", required=True, help="nombre=ruta.pt; el primero es la referencia de McNemar")
    ev.add_argument("--umbrales", nargs="+", type=float, default=[0.22, 0.35])
    ev.add_argument("--imgsz", type=int, default=512)
    ev.add_argument("--threads", type=int, default=4)
    ev.add_argument("--descripcion", default="", help="Descripción del conjunto para el JSON")
    ev.add_argument("--out", required=True)
    sv = sub.add_parser("svg", help="Dibujar la matriz de un modelo a partir del JSON")
    sv.add_argument("--json", required=True)
    sv.add_argument("--modelo", required=True)
    sv.add_argument("--umbral", type=float, default=0.35)
    sv.add_argument("--titulo", default="Matriz de confusión — detector YOLO26n")
    sv.add_argument("--subtitulo", default="Open Images V7 · conjunto de prueba")
    sv.add_argument("--lectura", nargs="*", default=[], help="Líneas del recuadro (debajo de las fórmulas)")
    sv.add_argument("--nota", nargs="*", default=[], help="Líneas del pie de figura")
    sv.add_argument("--out", required=True)
    args = ap.parse_args()
    evaluar(args) if args.modo == "evaluar" else svg(args)


if __name__ == "__main__":
    main()
