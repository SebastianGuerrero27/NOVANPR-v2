"""
Calidad de la captura de cada cámara, medida en las placas que registra, y qué ajustar en la cámara.

El OCR no recupera píxeles que no existen: una placa de 65 px de ancho, movida u oscura se lee mal con
cualquier modelo. Aquí se resumen las últimas placas de la cámara (ancho en píxeles, nitidez, brillo y
saturación) y se traducen en ajustes concretos: zoom o encuadre, obturación, iluminación o contraluz.

La nitidez es la varianza del laplaciano del recorte llevado a 64 px de alto, para que no dependa del
tamaño de la placa. Los umbrales se calibraron con recortes reales de la garita (ver
docs/CAPTURA_Y_REALCE_DE_PLACAS.md) y son orientativos: el diagnóstico sugiere, no decide.
"""

from __future__ import annotations

import os
import threading
from collections import deque
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

ANCHO_MINIMO_PX = 130
ANCHO_OBJETIVO_PX = 180
# Recortes reales de la garita: nítidos, mediana 1326; movidos 3 px, 594; movidos 6 px (la lectura cae al
# 20 %), 387; de noche, 128 (la poca luz también baja la nitidez)
NITIDEZ_MINIMA = float(os.getenv("CAPTURA_NITIDEZ_MINIMA", "450"))
BRILLO_MINIMO = 70
SATURADA_MAXIMA = 0.12
MUESTRAS = 40
MINIMO_PARA_OPINAR = 5


@dataclass(frozen=True)
class MuestraPlaca:
    ancho_px: int
    nitidez: float
    brillo: float
    saturada: float


def medir_placa(recorte: np.ndarray) -> Optional[MuestraPlaca]:
    """Ancho, nitidez normalizada, brillo medio y fracción de píxeles saturados de un recorte de placa."""
    if recorte is None or recorte.size == 0 or recorte.shape[0] < 4 or recorte.shape[1] < 8:
        return None
    gris = recorte if recorte.ndim == 2 else cv2.cvtColor(recorte, cv2.COLOR_BGR2GRAY)
    alto, ancho = gris.shape[:2]
    normal = cv2.resize(gris, (max(8, int(round(ancho * 64.0 / alto))), 64), interpolation=cv2.INTER_AREA if alto > 64 else cv2.INTER_CUBIC)
    return MuestraPlaca(
        ancho_px=int(ancho),
        nitidez=float(cv2.Laplacian(normal, cv2.CV_64F).var()),
        brillo=float(gris.mean()),
        saturada=float((gris >= 250).mean()),
    )


def recomendaciones(ancho_p50: float, nitidez_p50: float, brillo_p50: float, saturada_p50: float) -> list[dict]:
    """Ajustes de la cámara, del más importante al menos importante."""
    salida = []
    if ancho_p50 < ANCHO_MINIMO_PX:
        salida.append({
            "codigo": "placa_pequena",
            "texto": f"Las placas miden unos {int(ancho_p50)} px de ancho: acerque el zoom o cierre el encuadre "
                     f"para llegar a {ANCHO_MINIMO_PX}–{ANCHO_OBJETIVO_PX} px.",
        })
    # De noche la poca luz también baja la nitidez: primero se pide luz, no otra obturación
    if nitidez_p50 < NITIDEZ_MINIMA and brillo_p50 >= BRILLO_MINIMO:
        salida.append({
            "codigo": "placa_movida",
            "texto": "Las placas salen poco nítidas (movidas o desenfocadas): fije la obturación en 1/250 s o más "
                     "rápida y revise el enfoque.",
        })
    if brillo_p50 < BRILLO_MINIMO:
        salida.append({
            "codigo": "placa_oscura",
            "texto": "Las placas salen oscuras: active el infrarrojo o agregue iluminación, y suba la ganancia "
                     "solo si no aparece ruido.",
        })
    if saturada_p50 > SATURADA_MAXIMA:
        salida.append({
            "codigo": "placa_saturada",
            "texto": "Las placas salen quemadas por faros o sol: active la compensación de contraluz (BLC/HLC) o "
                     "WDR, o baje la exposición.",
        })
    return salida


class CalidadCaptura:
    """Últimas placas registradas de una cámara (segura entre hilos)."""

    def __init__(self, muestras: int = MUESTRAS) -> None:
        self._muestras: deque[MuestraPlaca] = deque(maxlen=muestras)
        self._candado = threading.Lock()

    def registrar(self, recorte: np.ndarray) -> Optional[MuestraPlaca]:
        muestra = medir_placa(recorte)
        if muestra is not None:
            with self._candado:
                self._muestras.append(muestra)
        return muestra

    def resumen(self) -> dict:
        with self._candado:
            m = list(self._muestras)
        if len(m) < MINIMO_PARA_OPINAR:
            return {"placas": len(m), "ancho_px_p50": None, "nitidez_p50": None, "brillo_p50": None,
                    "saturada_pct_p50": None, "recomendaciones": []}
        p50 = lambda v: float(np.median(v))  # noqa: E731
        ancho, nitidez = p50([x.ancho_px for x in m]), p50([x.nitidez for x in m])
        brillo, saturada = p50([x.brillo for x in m]), p50([x.saturada for x in m])
        return {
            "placas": len(m), "ancho_px_p50": int(ancho), "nitidez_p50": round(nitidez, 1),
            "brillo_p50": round(brillo, 1), "saturada_pct_p50": round(100 * saturada, 1),
            "recomendaciones": recomendaciones(ancho, nitidez, brillo, saturada),
        }
