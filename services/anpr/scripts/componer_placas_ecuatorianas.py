"""
Escenas reales con placas ecuatorianas para afinar el detector sin olvidar las fotos reales.

El afinamiento del 18/10/2026 con los 8 000 recortes de dataset/openimages_plates_ecuatorianas
(la placa ocupa ~66 % de la imagen) bajó el mAP50-95 en fotos reales de 54,6 % a 14,5 %: el
detector aprendió que "la placa es la imagen". Aquí cada recorte se usa como textura:

  1. Se rectifica la placa con sus cuatro esquinas (solo recortes con las cuatro visibles).
  2. En una escena de Open Images V7 se borra la placa real (inpainting) y en su lugar se pega la
     placa ecuatoriana con proporción 404 x 154 mm, rotación y perspectiva leves, la iluminación y el
     tono medidos sobre la placa original, desenfoque, ruido y compresión JPEG.
  3. La etiqueta es la caja de la placa pegada. Las placas pequeñas (< 10 px), las que se solapan con
     otra o las que quedarían fuera de la imagen conservan la placa y la etiqueta originales.

Particiones sin cruces: escenas train <- recortes train; escenas val <- recortes val pares;
escenas test <- recortes val impares. La prueba compuesta (escenas test de Open Images) solo se usa
para evaluar. El entrenamiento mezcla las escenas compuestas con una fracción de las originales
(repaso) para conservar la detección de placas de otros países y de fotos reales.

Uso (desde services/anpr):
    python scripts/componer_placas_ecuatorianas.py
Resultado:
    dataset/detector_ecuador_mixto/{images,labels}/{train,val}, data.yaml, provenance.json, preview/
    dataset/openimages_test_ecuador_compuesto/{images,labels}/test, data.yaml, provenance.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
ESCENAS = BASE_DIR / "dataset" / "openimages_plates"
PLACAS = BASE_DIR / "dataset" / "openimages_plates_ecuatorianas"
SALIDA = BASE_DIR / "dataset" / "detector_ecuador_mixto"
SALIDA_TEST = BASE_DIR / "dataset" / "openimages_test_ecuador_compuesto"
ASPECTO = 404 / 154  # placa ecuatoriana de auto (scripts/generate_synthetic_plates.py)
MIN_LADO = 10


def leer_cajas(etiqueta: Path, w: int, h: int) -> list[list[float]]:
    cajas = []
    for linea in etiqueta.read_text(encoding="utf-8").splitlines():
        partes = linea.split()
        if len(partes) == 5:
            _, cx, cy, bw, bh = map(float, partes)
            cajas.append([(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h])
    return cajas


def recortes_validos(split: str) -> list[tuple[Path, np.ndarray]]:
    """Recortes cuyas cuatro esquinas son visibles (v = 2): (ruta, esquinas TL, TR, BR, BL normalizadas)."""
    validos = []
    for etiqueta in sorted((PLACAS / "labels" / split).glob("*.txt")):
        valores = list(map(float, etiqueta.read_text(encoding="utf-8").split()))
        if len(valores) != 17:
            continue
        esquinas = np.array(valores[5:], dtype=np.float32).reshape(4, 3)
        if np.all(esquinas[:, 2] == 2):
            validos.append((PLACAS / "images" / split / f"{etiqueta.stem}.jpg", esquinas[:, :2]))
    return validos


def rectificar(ruta: Path, esquinas: np.ndarray) -> np.ndarray | None:
    img = cv2.imread(str(ruta))
    if img is None:
        return None
    h, w = img.shape[:2]
    quad = esquinas * np.array([w, h], dtype=np.float32)
    alto = 154
    ancho = round(alto * ASPECTO)
    destino = np.array([[0, 0], [ancho - 1, 0], [ancho - 1, alto - 1], [0, alto - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(quad, destino)
    return cv2.warpPerspective(img, m, (ancho, alto), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def solapa(caja, otras) -> bool:
    return any(min(caja[2], o[2]) > max(caja[0], o[0]) and min(caja[3], o[3]) > max(caja[1], o[1]) for o in otras)


def pegar(escena: np.ndarray, caja: list[float], placa: np.ndarray, rng: random.Random) -> list[float] | None:
    """Reemplaza la placa de `caja` por `placa`; devuelve la nueva caja o None si no cabe."""
    h, w = escena.shape[:2]
    x0, y0, x1, y1 = caja
    bw, bh = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ancho = bw * rng.uniform(0.95, 1.15)
    alto = ancho / ASPECTO
    if alto > 1.6 * bh:  # placas originales muy alargadas: no tapar medio vehículo
        ancho, alto = ancho * 1.6 * bh / alto, 1.6 * bh
    # Rectángulo centrado, rotación leve y perspectiva (una arista vertical más corta = giro)
    esquinas = np.array([[-ancho / 2, -alto / 2], [ancho / 2, -alto / 2],
                         [ancho / 2, alto / 2], [-ancho / 2, alto / 2]], dtype=np.float32)
    giro = rng.uniform(0, 0.12) * alto / 2
    if rng.random() < 0.5:
        esquinas[1, 1] += giro
        esquinas[2, 1] -= giro
    else:
        esquinas[0, 1] += giro
        esquinas[3, 1] -= giro
    esquinas += np.array([[rng.uniform(-0.03, 0.03) * ancho, rng.uniform(-0.04, 0.04) * alto] for _ in range(4)],
                         dtype=np.float32)
    ang = np.deg2rad(rng.uniform(-5, 5))
    rot = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]], dtype=np.float32)
    quad = esquinas @ rot.T + np.array([cx, cy], dtype=np.float32)
    nx0, ny0 = quad.min(axis=0)
    nx1, ny1 = quad.max(axis=0)
    if nx0 < -0.02 * w or ny0 < -0.02 * h or nx1 > 1.02 * w or ny1 > 1.02 * h:
        return None

    # Iluminación y tono de la placa original (misma luz en ese punto de la escena)
    ix0, iy0, ix1, iy1 = max(0, int(x0)), max(0, int(y0)), min(w, int(np.ceil(x1))), min(h, int(np.ceil(y1)))
    region = escena[iy0:iy1, ix0:ix1].reshape(-1, 3).astype(np.float32)
    if len(region) == 0:
        return None
    media_original = region.mean(axis=0)
    p = placa.astype(np.float32)
    gris_placa = float(p.mean()) + 1e-3
    gris_original = float(media_original.mean()) + 1e-3
    factor = np.clip(gris_original / gris_placa * rng.uniform(0.85, 1.15), 0.3, 1.6)
    tono = np.clip((media_original / gris_original) ** 0.5, 0.8, 1.25)
    p = np.clip(p * factor * tono, 0, 255)

    # Borrar la placa real y pegar la nueva con borde suavizado
    mascara_borrado = np.zeros((h, w), np.uint8)
    cv2.rectangle(mascara_borrado, (ix0 - 1, iy0 - 1), (ix1, iy1), 255, -1)
    escena[:] = cv2.inpaint(escena, mascara_borrado, 3, cv2.INPAINT_TELEA)
    # Reducir antes de deformar (warpPerspective no promedia al encoger: evita el aliasing)
    if ancho < p.shape[1]:
        p = cv2.resize(p, (max(4, round(ancho)), max(2, round(alto))), interpolation=cv2.INTER_AREA)
    ph, pw = p.shape[:2]
    origen = np.array([[0, 0], [pw - 1, 0], [pw - 1, ph - 1], [0, ph - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(origen, quad)
    pegada = cv2.warpPerspective(p, m, (w, h), flags=cv2.INTER_LINEAR)
    alfa = cv2.warpPerspective(np.full((ph, pw), 1.0, np.float32), m, (w, h), flags=cv2.INTER_LINEAR)
    alfa = cv2.GaussianBlur(alfa, (3, 3), 0)
    if rng.random() < 0.5:
        sigma = rng.uniform(0.3, 1.2)
        pegada = cv2.GaussianBlur(pegada, (0, 0), sigma)
        alfa = cv2.GaussianBlur(alfa, (0, 0), sigma)
    alfa = alfa[..., None]
    ruido = np.random.default_rng(rng.randrange(2**32)).normal(0, rng.uniform(0, 5), pegada.shape).astype(np.float32)
    mezcla = escena.astype(np.float32) * (1 - alfa) + (pegada + ruido) * alfa
    escena[:] = np.clip(mezcla, 0, 255).astype(np.uint8)
    return [max(0.0, float(nx0)), max(0.0, float(ny0)), min(float(w), float(nx1)), min(float(h), float(ny1))]


def a_yolo(cajas: list[list[float]], w: int, h: int) -> str:
    lineas = []
    for x0, y0, x1, y1 in cajas:
        if x1 - x0 >= 2 and y1 - y0 >= 2:
            lineas.append(f"0 {(x0 + x1) / 2 / w:.6f} {(y0 + y1) / 2 / h:.6f} {(x1 - x0) / w:.6f} {(y1 - y0) / h:.6f}")
    return "\n".join(lineas) + ("\n" if lineas else "")


def componer_split(split_escenas: str, recortes, destino: Path, split_destino: str, rng: random.Random,
                   p_reemplazo: float, p_original: float, calidad: tuple[int, int], cache: dict) -> dict:
    (destino / "images" / split_destino).mkdir(parents=True, exist_ok=True)
    (destino / "labels" / split_destino).mkdir(parents=True, exist_ok=True)
    stats = {"escenas": 0, "compuestas": 0, "originales": 0, "placas_ecuatorianas": 0, "placas_originales_conservadas": 0}
    for ruta in sorted((ESCENAS / "images" / split_escenas).glob("*.jpg")):
        escena = cv2.imread(str(ruta))
        if escena is None:
            continue
        h, w = escena.shape[:2]
        etiqueta = ESCENAS / "labels" / split_escenas / f"{ruta.stem}.txt"
        cajas = leer_cajas(etiqueta, w, h)
        stats["escenas"] += 1
        if p_original and rng.random() < p_original:
            shutil.copy2(ruta, destino / "images" / split_destino / f"oi_{ruta.stem}.jpg")
            shutil.copy2(etiqueta, destino / "labels" / split_destino / f"oi_{ruta.stem}.txt")
            stats["originales"] += 1
        nuevas = []
        for i, caja in enumerate(cajas):
            otras = cajas[:i] + cajas[i + 1:]
            reemplazar = (caja[2] - caja[0] >= MIN_LADO and caja[3] - caja[1] >= MIN_LADO / 2
                          and not solapa(caja, otras) and rng.random() < p_reemplazo)
            nueva = None
            if reemplazar:
                ruta_placa, esquinas = recortes[rng.randrange(len(recortes))]
                if ruta_placa not in cache:
                    cache[ruta_placa] = rectificar(ruta_placa, esquinas)
                if cache[ruta_placa] is not None:
                    nueva = pegar(escena, caja, cache[ruta_placa], rng)
            if nueva is None:
                nuevas.append(caja)
                stats["placas_originales_conservadas"] += 1
            else:
                nuevas.append(nueva)
                stats["placas_ecuatorianas"] += 1
        nombre = f"ec_{ruta.stem}"
        cv2.imwrite(str(destino / "images" / split_destino / f"{nombre}.jpg"), escena,
                    [cv2.IMWRITE_JPEG_QUALITY, rng.randint(*calidad)])
        (destino / "labels" / split_destino / f"{nombre}.txt").write_text(a_yolo(nuevas, w, h), encoding="utf-8")
        stats["compuestas"] += 1
        if stats["escenas"] % 500 == 0:
            print(f"    {split_escenas} -> {destino.name}/{split_destino}: {stats['escenas']}", flush=True)
    return stats


def hoja_contactos(carpeta: Path, salida: Path, n: int = 12, semilla: int = 0) -> None:
    imagenes = sorted((carpeta / "images" / "train").glob("ec_*.jpg"))
    muestra = random.Random(semilla).sample(imagenes, min(n, len(imagenes)))
    celdas = []
    for ruta in muestra:
        img = cv2.imread(str(ruta))
        h, w = img.shape[:2]
        for caja in leer_cajas(carpeta / "labels" / "train" / f"{ruta.stem}.txt", w, h):
            cv2.rectangle(img, (int(caja[0]), int(caja[1])), (int(caja[2]), int(caja[3])), (0, 255, 0), 2)
        escala = 400 / max(h, w)
        img = cv2.resize(img, (int(w * escala), int(h * escala)))
        lienzo = np.full((400, 400, 3), 30, np.uint8)
        lienzo[:img.shape[0], :img.shape[1]] = img
        celdas.append(lienzo)
    filas = [np.hstack(celdas[i:i + 4]) for i in range(0, len(celdas) - len(celdas) % 4, 4)]
    salida.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(salida), np.vstack(filas), [cv2.IMWRITE_JPEG_QUALITY, 88])


def huella(carpeta: Path) -> str:
    digest = hashlib.sha256()
    for ruta in sorted(carpeta.rglob("*")):
        if ruta.is_file() and ruta.suffix in {".jpg", ".txt"}:
            digest.update(ruta.relative_to(carpeta).as_posix().encode())
            digest.update(hashlib.sha256(ruta.read_bytes()).digest())
    return digest.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--semilla", type=int, default=0)
    ap.add_argument("--p-reemplazo", type=float, default=0.85, help="Probabilidad de reemplazar cada placa en train")
    ap.add_argument("--p-original", type=float, default=0.5, help="Fracción de escenas train originales (repaso)")
    args = ap.parse_args()

    for carpeta in (SALIDA, SALIDA_TEST):
        if carpeta.exists():
            raise SystemExit(f"{carpeta} ya existe: bórrela o renómbrela para no mezclar corridas.")
    for split in ("train", "val", "test"):
        if not (ESCENAS / "images" / split).is_dir():
            raise SystemExit(f"Falta {ESCENAS / 'images' / split}: ejecute scripts/prepare_openimages_plates.py")

    rng = random.Random(args.semilla)
    inicio = time.time()
    rec_train = recortes_validos("train")
    rec_val = recortes_validos("val")
    rec_val_pares, rec_val_impares = rec_val[0::2], rec_val[1::2]
    print(f"[+] Recortes con 4 esquinas visibles: train {len(rec_train)}, val {len(rec_val_pares)} + test {len(rec_val_impares)}")
    cache: dict = {}
    stats = {
        "train": componer_split("train", rec_train, SALIDA, "train", rng, args.p_reemplazo, args.p_original, (75, 95), cache),
        "val": componer_split("val", rec_val_pares, SALIDA, "val", rng, 1.0, 1.0, (80, 95), cache),
        "test": componer_split("test", rec_val_impares, SALIDA_TEST, "test", rng, 1.0, 0.0, (80, 95), cache),
    }
    (SALIDA / "data.yaml").write_text(
        "# Escenas de Open Images V7 con placas ecuatorianas pegadas + escenas originales (repaso).\n"
        "# Generado por services/anpr/scripts/componer_placas_ecuatorianas.py; rutas relativas al YAML.\n"
        "train: images/train\nval: images/val\nnames:\n  0: license_plate\n", encoding="utf-8")
    (SALIDA_TEST / "data.yaml").write_text(
        "# Prueba compuesta: escenas test de Open Images V7 con placas ecuatorianas (recortes val impares).\n"
        "# Solo evaluación; nunca entrenar con estas imágenes.\n"
        "train: images/test\nval: images/test\ntest: images/test\nnames:\n  0: license_plate\n", encoding="utf-8")
    hoja_contactos(SALIDA, SALIDA / "preview" / "contact_sheet.jpg", semilla=args.semilla)
    comun = {
        "fecha": time.strftime("%Y-%m-%d"), "script": "services/anpr/scripts/componer_placas_ecuatorianas.py",
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "semilla": args.semilla, "escenas": "Open Images V7 Vehicle registration plate (scripts/prepare_openimages_plates.py)",
        "placas": "dataset/openimages_plates_ecuatorianas (recortes sintéticos; solo los de 4 esquinas visibles)",
        "recortes": {"train": len(rec_train), "val_pares": len(rec_val_pares), "val_impares_test": len(rec_val_impares)},
        "limitaciones": [
            "Las placas pegadas son sintéticas: la prueba compuesta mide el diseño ecuatoriano en contexto real, "
            "no sustituye fotografías reales de vehículos ecuatorianos.",
            "Las placas originales de menos de 10 px, solapadas o que quedarían fuera de la imagen se conservan.",
        ],
        "segundos": round(time.time() - inicio, 1),
    }
    (SALIDA / "provenance.json").write_text(json.dumps({
        **comun, "p_reemplazo_train": args.p_reemplazo, "p_original_train": args.p_original,
        "splits": {"train": stats["train"], "val": stats["val"]}, "sha256": huella(SALIDA),
        "synthetic_origin_inferred": True}, ensure_ascii=False, indent=2), encoding="utf-8")
    (SALIDA_TEST / "provenance.json").write_text(json.dumps({
        **comun, "splits": {"test": stats["test"]}, "sha256": huella(SALIDA_TEST)},
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
