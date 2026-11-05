"""
Banco de realce para OCR de placas con recortes reales del video de la garita
(docs/CAPTURA_Y_REALCE_DE_PLACAS.md). Corre dentro de la imagen del motor:

  docker run --rm --cpus 4 -e OCR_ENGINE=plate -e OCR_VERIFIER_ENABLED=true -e YOLO_OFFLINE=true     -v <carpeta de la secuencia>:/datos:ro -v <video>:/video/entrada.mp4:ro -v <salida>:/salida     -v services/anpr/scripts/banco_realce_acuerdo.py:/b.py:ro anpr-motor:produccion python -u /b.py

La secuencia etiquetada y el video tienen placas reales: no se versionan.

Condiciones (sobre el mismo recorte): original, noche simulada (poca luz + ruido de sensor + compresión),
placa pequeña (65 px de ancho) y movida (desenfoque horizontal de 6 px).
Métodos:
  M0  como en producción: fast-plate-ocr sin realce + PP-OCRv6; se registra PP-OCRv6 si tiene formato ANT;
      confirmada si los dos lectores coinciden.
  M1  M0 con el realce clásico de baja luz (gamma acotada + CLAHE) antes de los dos lectores.
  M2  propuesto: selección del realce por acuerdo entre lectores (ASAL). Variantes baratas del recorte;
      fast-plate-ocr lee todas, PP-OCRv6 lee la original y la mejor según fast-plate-ocr; gana la placa con
      más apoyo ponderado; confirmada solo si la leen los DOS lectores.
La salida no contiene placas: solo aciertos por condición y método.
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
from collections import defaultdict

import cv2
import numpy as np

sys.path.insert(0, "/app")
from app.dominio.ecuador_plate_validator import validate_ecuadorian_plate  # noqa: E402
from app.infraestructura.ocr_engine import create_ocr_engine  # noqa: E402
from app.infraestructura.ocr_verifier import get_verifier  # noqa: E402

random.seed(7)
np.random.seed(7)

SEC = json.load(open(os.environ.get("SECUENCIA", "/datos/secuencia_etiquetada.json"), encoding="utf-8"))
VIDEO = os.environ.get("VIDEO", "/video/entrada.mp4")
SALIDA = os.environ.get("SALIDA", "/salida")
FPS_MUESTRA = float(os.environ.get("FPS_MUESTRA", "4"))
ROI = SEC.get("zonas", {})


def norm(t: str) -> str:
    return "".join(c for c in (t or "").upper() if c.isalnum())


def ant(t: str) -> str:
    """Placa con formato ANT o cadena vacía."""
    ok, formateada, _ = validate_ecuadorian_plate(t or "")
    return norm(formateada) if ok else ""


# ─── 1. Recortes reales con su placa ─────────────────────────────────────────
def recortes():
    from ultralytics import YOLO
    det = YOLO("/app/models/license_plate_detector.pt")
    cap = cv2.VideoCapture(VIDEO)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    salida = []
    for p in SEC["pasos"]:
        if not p.get("legible") or not p.get("placa"):
            continue
        placa = norm(p["placa"])
        t = p["inicio_s"]
        while t <= p["fin_s"]:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
            ok, f = cap.read()
            t += 1.0 / FPS_MUESTRA
            if not ok:
                continue
            r = det.predict(source=f, imgsz=960, conf=0.35, device="cpu", verbose=False)[0]
            if r.boxes is None or not len(r.boxes):
                continue
            b = max(r.boxes.xyxy.cpu().numpy().tolist(), key=lambda q: (q[2] - q[0]) * (q[3] - q[1]))
            x1, y1, x2, y2 = b
            w, h = x2 - x1, y2 - y1
            m = 0.08
            c = f[int(max(0, y1 - h * m)):int(y2 + h * m), int(max(0, x1 - w * m)):int(x2 + w * m)]
            if c.size and w >= 40:
                salida.append({"paso": p["paso"], "placa": placa, "img": c, "ancho": int(w)})
    return salida


# ─── 2. Condiciones ──────────────────────────────────────────────────────────
def jpeg(img, q):
    return cv2.imdecode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)


def noche(img):
    """Escena con ~8 % de la luz: menos fotones (ruido de disparo), ruido de lectura y compresión."""
    lin = (img.astype(np.float32) / 255.0) ** 2.2
    escala = 0.08
    fotones = 900.0
    ruido = np.random.poisson(lin * escala * fotones) / fotones + np.random.normal(0, 0.004, lin.shape)
    out = np.clip(ruido, 0, 1) ** (1 / 2.2)
    return jpeg((out * 255).astype(np.uint8), 45)


def pequena(img, ancho=65):
    h, w = img.shape[:2]
    e = ancho / float(w)
    return jpeg(cv2.resize(img, (ancho, max(8, int(h * e))), interpolation=cv2.INTER_AREA), 70)


def movida(img, px=6):
    k = np.zeros((1, px), np.float32)
    k[0, :] = 1.0 / px
    return jpeg(cv2.filter2D(img, -1, k), 70)


CONDICIONES = {"original": lambda x: x, "noche": noche, "pequena": pequena, "movida": movida}


# ─── 3. Realces ──────────────────────────────────────────────────────────────
def gamma_auto(img):
    y = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    m = max(1.0, float(np.median(y)))
    g = float(np.clip(np.log(0.45) / np.log(m / 255.0), 0.35, 1.6))
    lut = np.clip(((np.arange(256) / 255.0) ** g) * 255, 0, 255).astype(np.uint8)
    return cv2.LUT(img, lut)


def clahe(img, clip=2.0):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip, tileGridSize=(4, 8)).apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def baja_luz_clasico(img):
    """Realce de baja luz del motor (docs/ANPR_BAJA_ILUMINACION.md): gamma acotada + CLAHE si está oscuro."""
    y = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if np.mean(y) < 90 and np.percentile(y, 75) < 130:
        return clahe(gamma_auto(img), 2.2)
    return img


def denoise(img):
    return cv2.fastNlMeansDenoisingColored(img, None, 7, 7, 5, 11)


def ampliar(img):
    h, w = img.shape[:2]
    f = max(1.0, 160.0 / w)
    a = cv2.resize(img, (int(w * f), int(h * f)), interpolation=cv2.INTER_LANCZOS4)
    s = cv2.GaussianBlur(a, (0, 0), 1.2)
    return cv2.addWeighted(a, 1.6, s, -0.6, 0)


VARIANTES = {
    "original": lambda x: x,
    "gamma": gamma_auto,
    "clahe": lambda x: clahe(gamma_auto(x)),
    "denoise": lambda x: clahe(denoise(gamma_auto(x)), 1.5),
    "ampliada": lambda x: ampliar(denoise(x)) if x.shape[1] < 120 else ampliar(x),
}

OCR = create_ocr_engine()
VER = get_verifier()
assert VER is not None


def rapido(img):
    r = OCR.read_text(img)
    return (norm(r[0].text), float(r[0].confidence)) if r else ("", 0.0)


def verificador(img):
    v = VER.read(img)
    return (norm(v.plate), float(v.confidence)) if v.within_budget else ("", 0.0)


def decidir(lecturas_rapidas, lecturas_verificador):
    """Como el motor: se registra la del verificador si tiene formato ANT; si no, la del rápido.
    Confirmada si alguna lectura del verificador coincide con alguna del rápido."""
    rapidas = [ant(t) for t, _ in lecturas_rapidas if ant(t)]
    verif = [ant(t) for t, _ in lecturas_verificador if ant(t)]
    return rapidas, verif


def m0(img):
    t0 = time.perf_counter()
    r, v = rapido(img), verificador(img)
    ms = (time.perf_counter() - t0) * 1000
    pr, pv = ant(r[0]), ant(v[0])
    placa = pv or pr
    return placa, bool(pv and pv == pr), ms


def m1(img):
    t0 = time.perf_counter()
    x = baja_luz_clasico(img)
    r, v = rapido(x), verificador(x)
    ms = (time.perf_counter() - t0) * 1000
    pr, pv = ant(r[0]), ant(v[0])
    return pv or pr, bool(pv and pv == pr), ms


def m2(img):
    """ASAL: apoyo por placa = suma de confianzas de cada (lector, variante) que la lee con formato ANT;
    los dos lectores pesan igual. Confirmada solo si la leen los dos lectores."""
    t0 = time.perf_counter()
    vistas = {n: f(img) for n, f in VARIANTES.items()}
    rapidas = {n: rapido(x) for n, x in vistas.items()}
    mejor = max(rapidas, key=lambda n: (bool(ant(rapidas[n][0])), rapidas[n][1]))
    verif = {"original": verificador(vistas["original"])}
    if mejor != "original":
        verif[mejor] = verificador(vistas[mejor])
    apoyo = defaultdict(float)
    lectores = defaultdict(set)
    for n, (t, c) in rapidas.items():
        if ant(t):
            apoyo[ant(t)] += c / len(rapidas)
            lectores[ant(t)].add("rapido")
    for n, (t, c) in verif.items():
        if ant(t):
            apoyo[ant(t)] += c / len(verif)
            lectores[ant(t)].add("verificador")
    ms = (time.perf_counter() - t0) * 1000
    if not apoyo:
        return "", False, ms
    placa = max(apoyo, key=lambda p: (len(lectores[p]), apoyo[p]))
    return placa, lectores[placa] == {"rapido", "verificador"}, ms


def m3(img):
    """ASAL seguro: el acuerdo entre lectores sobre las variantes elige la placa que se registra, pero la
    confirmación es la de producción (los dos lectores coinciden en la imagen original)."""
    t0 = time.perf_counter()
    vistas = {n: f(img) for n, f in VARIANTES.items()}
    rapidas = {n: rapido(x) for n, x in vistas.items()}
    mejor = max(rapidas, key=lambda n: (bool(ant(rapidas[n][0])), rapidas[n][1]))
    verif = {"original": verificador(vistas["original"])}
    if mejor != "original":
        verif[mejor] = verificador(vistas[mejor])
    apoyo = defaultdict(float)
    lectores = defaultdict(set)
    for n, (t, c) in rapidas.items():
        if ant(t):
            apoyo[ant(t)] += c / len(rapidas)
            lectores[ant(t)].add("rapido")
    for n, (t, c) in verif.items():
        if ant(t):
            apoyo[ant(t)] += c / len(verif)
            lectores[ant(t)].add("verificador")
    ms = (time.perf_counter() - t0) * 1000
    if not apoyo:
        return "", False, ms
    placa = max(apoyo, key=lambda p: (len(lectores[p]), apoyo[p]))
    pr, pv = ant(rapidas["original"][0]), ant(verif["original"][0])
    return placa, bool(pv and pv == pr == placa), ms


METODOS = {"M0_produccion": m0, "M1_baja_luz_clasico": m1, "M2_acuerdo_lectores": m2, "M3_acuerdo_seguro": m3}

if __name__ == "__main__":
    datos = recortes()
    anchos = sorted(d["ancho"] for d in datos)
    print(json.dumps({"recortes": len(datos), "pasos": len({d["paso"] for d in datos}),
                      "ancho_px": {"min": anchos[0], "p50": anchos[len(anchos) // 2], "max": anchos[-1]}}), flush=True)
    resultados = {}
    por_recorte = {}
    for nc, fc in CONDICIONES.items():
        degradados = [(d, fc(d["img"])) for d in datos]
        for nm, fm in METODOS.items():
            acierto = conf_ok = conf_mal = sin = 0
            tiempos = []
            por_paso = defaultdict(lambda: defaultdict(int))
            for i, (d, img) in enumerate(degradados):
                placa, confirmada, ms = fm(img)
                por_recorte.setdefault(nc, {}).setdefault(nm, []).append([d["paso"], int(bool(placa) and placa == d["placa"]), int(confirmada and placa != d["placa"])])
                tiempos.append(ms)
                if not placa:
                    sin += 1
                elif placa == d["placa"]:
                    acierto += 1
                    conf_ok += confirmada
                else:
                    conf_mal += confirmada
                if placa:
                    por_paso[d["paso"]][placa == d["placa"]] += 1
            n = len(degradados)
            tiempos.sort()
            # Por vehículo: correcto si la placa correcta gana el voto de sus recortes
            pasos_ok = sum(1 for p, v in por_paso.items() if v[True] > v[False])
            resultados[f"{nc}/{nm}"] = {
                "exacta_pct": round(100 * acierto / n, 1), "confirmada_correcta_pct": round(100 * conf_ok / n, 1),
                "confirmada_erronea": conf_mal, "sin_lectura": sin, "n": n,
                "pasos_correctos": f"{pasos_ok}/{len({d['paso'] for d in datos})}",
                "ms_p50": round(tiempos[n // 2]), "ms_p95": round(tiempos[int(n * .95)]),
            }
            print(nc, nm, json.dumps(resultados[f"{nc}/{nm}"]), flush=True)
    json.dump(resultados, open(os.path.join(SALIDA, "banco_realce.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(por_recorte, open(os.path.join(SALIDA, "por_recorte.json"), "w", encoding="utf-8"))
