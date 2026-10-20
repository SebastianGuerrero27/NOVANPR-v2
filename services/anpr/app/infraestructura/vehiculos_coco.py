"""
Detector de vehículos YOLO26n (COCO) para los pasos sin placa (app/aplicacion/paso_sin_placa.py).

Corre una vez por evento de movimiento que el flujo de placas no registró, no en cada cuadro: confirma
que lo que se movió en la zona es un auto, una moto, un bus o un camión (y no una persona). El modelo
se carga la primera vez que se necesita; si no está disponible, el motor no registra pasos sin placa.
"""

from __future__ import annotations

import threading
from typing import Callable, Optional

import numpy as np

from app.infraestructura.config import VEHICLE_DETECTOR_PATH
from app.infraestructura.logger import get_logger

_log = get_logger("vehiculos_coco")
_CLASES = {2: "automóvil", 3: "motocicleta", 5: "bus", 7: "camión"}
_candado = threading.Lock()
_modelo = None
_fallo = False

Deteccion = tuple[str, float, list[float]]


def get_detector_vehiculos() -> Optional[Callable[[np.ndarray], list[Deteccion]]]:
    """Función cuadro → [(tipo, confianza, caja x1 y1 x2 y2)], o None si el modelo no está disponible."""
    global _modelo, _fallo
    with _candado:
        if _modelo is None and not _fallo:
            try:
                from ultralytics import YOLO
                _modelo = YOLO(VEHICLE_DETECTOR_PATH)
                _log.info("Detector de vehículos para pasos sin placa: %s", VEHICLE_DETECTOR_PATH)
            except Exception as e:
                _fallo = True
                _log.warning("Sin detector de vehículos (%s): no se registrarán pasos sin placa", e)
        modelo = _modelo
    if modelo is None:
        return None

    def detectar(cuadro: np.ndarray) -> list[Deteccion]:
        with _candado:
            r = modelo.predict(cuadro, imgsz=640, conf=0.25, classes=list(_CLASES), verbose=False, device="cpu")[0]
        return [(_CLASES[int(c)], float(p), [float(v) for v in b])
                for b, c, p in zip(r.boxes.xyxy.tolist(), r.boxes.cls.tolist(), r.boxes.conf.tolist())]

    return detectar
