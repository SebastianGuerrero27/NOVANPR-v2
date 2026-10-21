"""
Pasos de vehículos en un video de la garita, para etiquetarlos y medir el recall por vehículo.

Los pasos se encuentran con un detector de VEHÍCULOS (YOLO26n COCO: auto, moto, bus, camión),
independiente del detector de placas: así aparecen también los vehículos cuya placa el detector
de producción no encuentra, que son justamente los que hay que contar como fallos.

  1. Recorre el video a --muestreo cuadros por segundo (decodifica todos, analiza algunos).
  2. Un vehículo cuenta si el centro inferior de su caja está en la vía de acceso (--roi, polígono
     normalizado) y su caja mide al menos --alto-min del cuadro (descarta el tráfico de la calle).
  3. Los cuadros con vehículo separados por menos de --hueco segundos forman un paso.
  4. En cada cuadro del paso corre el detector de placas de producción dentro del vehículo y guarda
     su mejor confianza: es la línea base "¿el detector vio la placa en algún cuadro?".

Salida en --out: pasos.json (inicio, fin, mejor cuadro, mejor confianza de placa) y una ficha por
paso (vehículo + recorte de la placa) para que una persona escriba el texto de la placa. Con esas
placas se arma la secuencia de scripts/evaluar_secuencias.py (recall por vehículo del motor completo).

Uso (desde services/anpr):
    python scripts/pasos_video.py ../../dataset/videos_garita/<video>.mp4 --out ../../dataset/garita/pasos_<video>
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

VEHICULOS = {2: "auto", 3: "moto", 5: "bus", 7: "camion"}


def dentro(poligono: np.ndarray, x: float, y: float) -> bool:
    return cv2.pointPolygonTest(poligono, (float(x), float(y)), False) >= 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", required=True)
    ap.add_argument("--roi", default="0.05,0.40 0.98,0.40 0.98,1.0 0.05,1.0",
                    help="Vía de acceso: vértices x,y normalizados separados por espacios")
    ap.add_argument("--muestreo", type=float, default=3.0, help="Cuadros analizados por segundo")
    ap.add_argument("--alto-min", type=float, default=0.12, help="Alto mínimo de la caja del vehículo (fracción)")
    ap.add_argument("--hueco", type=float, default=2.0, help="Segundos sin vehículo que cierran un paso")
    ap.add_argument("--vehiculos", default="yolo26n.pt")
    ap.add_argument("--placas", default="models/license_plate_detector.pt")
    ap.add_argument("--threads", type=int, default=8)
    args = ap.parse_args()

    import torch
    from ultralytics import YOLO

    torch.set_num_threads(args.threads)
    det_vehiculos, det_placas = YOLO(args.vehiculos), YOLO(args.placas)
    salida = Path(args.out)
    (salida / "fichas").mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    roi = np.array([[float(v) * (w if i == 0 else h) for i, v in enumerate(p.split(","))] for p in args.roi.split()], np.float32)
    paso_cuadros = max(1, round(fps / args.muestreo))

    observaciones = []  # (t, caja vehículo, clase, conf vehículo, conf placa, caja placa)
    inicio = time.time()
    indice = 0
    while True:
        if indice % paso_cuadros:
            if not cap.grab():
                break
            indice += 1
            continue
        ok, cuadro = cap.read()
        if not ok:
            break
        t = indice / fps
        r = det_vehiculos.predict(cuadro, imgsz=640, conf=0.35, classes=list(VEHICULOS), verbose=False, device="cpu")[0]
        for caja, clase, conf in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist()):
            x1, y1, x2, y2 = caja
            if (y2 - y1) < args.alto_min * h or not dentro(roi, (x1 + x2) / 2, y2):
                continue
            # Placa dentro del vehículo (con margen): mejor confianza del detector de producción
            mx, my = 0.05 * (x2 - x1), 0.05 * (y2 - y1)
            vx1, vy1 = max(0, int(x1 - mx)), max(0, int(y1 - my))
            vx2, vy2 = min(w, int(x2 + mx)), min(h, int(y2 + my))
            rp = det_placas.predict(cuadro[vy1:vy2, vx1:vx2], imgsz=512, conf=0.05, verbose=False, device="cpu")[0]
            conf_placa, caja_placa = 0.0, None
            if len(rp.boxes):
                j = int(rp.boxes.conf.argmax())
                conf_placa = float(rp.boxes.conf[j])
                px1, py1, px2, py2 = rp.boxes.xyxy[j].tolist()
                caja_placa = [px1 + vx1, py1 + vy1, px2 + vx1, py2 + vy1]
            observaciones.append({"t": round(t, 2), "cuadro": indice, "caja": [round(v, 1) for v in caja],
                                  "clase": VEHICULOS[int(clase)], "conf": round(conf, 3),
                                  "conf_placa": round(conf_placa, 3),
                                  "caja_placa": [round(v, 1) for v in caja_placa] if caja_placa else None})
        indice += 1
        if indice % (paso_cuadros * 600) == 0:
            print(f"  {t / 60:.1f} / {total / fps / 60:.1f} min · {len(observaciones)} observaciones · {time.time() - inicio:.0f} s", flush=True)

    # Agrupar en pasos por continuidad temporal
    pasos: list[dict] = []
    for o in observaciones:
        if pasos and o["t"] - pasos[-1]["fin_s"] <= args.hueco:
            pasos[-1]["fin_s"] = o["t"]
            pasos[-1]["obs"].append(o)
        else:
            pasos.append({"inicio_s": o["t"], "fin_s": o["t"], "obs": [o]})

    resumen = []
    for n, p in enumerate(pasos, 1):
        con_placa = [o for o in p["obs"] if o["caja_placa"]]
        mejor = max(con_placa, key=lambda o: o["conf_placa"]) if con_placa else max(p["obs"], key=lambda o: o["caja"][3] - o["caja"][1])
        cap.set(cv2.CAP_PROP_POS_FRAMES, mejor["cuadro"])
        ok, cuadro = cap.read()
        if ok:
            x1, y1, x2, y2 = (int(v) for v in mejor["caja"])
            vehiculo = cuadro[max(0, y1):y2, max(0, x1):x2]
            vehiculo = cv2.resize(vehiculo, (int(360 * vehiculo.shape[1] / max(1, vehiculo.shape[0])), 360))
            panel = [vehiculo]
            if mejor["caja_placa"]:
                a1, b1, a2, b2 = (int(v) for v in mejor["caja_placa"])
                placa = cuadro[max(0, b1 - 4):b2 + 4, max(0, a1 - 6):a2 + 6]
                placa = cv2.resize(placa, (int(120 * placa.shape[1] / max(1, placa.shape[0])), 120), interpolation=cv2.INTER_CUBIC)
                lienzo = np.full((360, placa.shape[1], 3), 30, np.uint8)
                lienzo[120:240] = placa
                panel.append(lienzo)
            ficha = np.hstack(panel)
            texto = f"paso {n} t={int(mejor['t']) // 60:02d}:{mejor['t'] % 60:04.1f} placa {mejor['conf_placa']:.2f}"
            cv2.putText(ficha, texto, (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            cv2.imwrite(str(salida / "fichas" / f"paso_{n:03d}.jpg"), ficha, [cv2.IMWRITE_JPEG_QUALITY, 90])
        clases = {o["clase"] for o in p["obs"]}
        resumen.append({
            "paso": n, "inicio_s": p["inicio_s"], "fin_s": p["fin_s"], "cuadros_con_vehiculo": len(p["obs"]),
            "clases": sorted(clases), "mejor_cuadro": mejor["cuadro"], "mejor_conf_placa": mejor["conf_placa"],
            "placa_detectada_0_22": any(o["conf_placa"] >= 0.22 for o in p["obs"]),
            "placa": None, "legible": None,
        })
    (salida / "pasos.json").write_text(json.dumps({
        "video": str(Path(args.video).name), "fps": fps, "cuadros": total, "resolucion": [w, h],
        "roi": args.roi, "muestreo_fps": args.muestreo, "alto_min": args.alto_min, "hueco_s": args.hueco,
        "detector_vehiculos": args.vehiculos, "detector_placas": args.placas,
        "segundos": round(time.time() - inicio, 1), "pasos": resumen,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    (salida / "observaciones.json").write_text(json.dumps(observaciones), encoding="utf-8")
    vistos = sum(p["placa_detectada_0_22"] for p in resumen)
    print(f"{len(resumen)} pasos; placa detectada (≥ 0,22) en algún cuadro: {vistos}. Fichas en {salida / 'fichas'}")


if __name__ == "__main__":
    main()
