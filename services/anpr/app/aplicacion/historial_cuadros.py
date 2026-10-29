"""
Historial de los últimos segundos de la cámara, para la evidencia del registro manual.

Cuando un vehículo pasa sin que el motor lo registre (muy rápido, sin placa legible), el guardia lo
registra a mano unos segundos después, y para entonces el vehículo ya no está frente a la cámara. El
historial guarda dos cuadros por segundo de los últimos 30 s, comprimidos en JPEG en memoria (unos
20 MB en 1080p) con su miniatura: el registro manual muestra las miniaturas y el cuadro que el
guardia elige queda como foto de evidencia del paso.

La compresión va en un hilo aparte: el hilo de captura solo entrega la referencia al cuadro (el
lector entrega una copia nueva de cada uno), así que no se retrasa la lectura de la cámara.
"""
from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

SEGUNDOS = 30.0
CUADROS_POR_SEGUNDO = 2.0
ANCHO_MINIATURA = 320
CALIDAD = 88
CALIDAD_MINIATURA = 70


@dataclass(frozen=True)
class CuadroGuardado:
    hora: float
    jpeg: bytes
    miniatura: bytes


def comprimir(cuadro: np.ndarray, hora: float) -> Optional[CuadroGuardado]:
    ok, jpeg = cv2.imencode(".jpg", cuadro, [cv2.IMWRITE_JPEG_QUALITY, CALIDAD])
    alto, ancho = cuadro.shape[:2]
    escala = ANCHO_MINIATURA / float(ancho)
    mini = cv2.resize(cuadro, (ANCHO_MINIATURA, max(1, int(alto * escala))), interpolation=cv2.INTER_AREA)
    ok_mini, jpeg_mini = cv2.imencode(".jpg", mini, [cv2.IMWRITE_JPEG_QUALITY, CALIDAD_MINIATURA])
    if not ok or not ok_mini:
        return None
    return CuadroGuardado(hora, jpeg.tobytes(), jpeg_mini.tobytes())


class HistorialCuadros:
    def __init__(self, segundos: float = SEGUNDOS, por_segundo: float = CUADROS_POR_SEGUNDO, en_hilo: bool = True) -> None:
        self._segundos = segundos
        self._intervalo = 1.0 / por_segundo
        self._cuadros: deque[CuadroGuardado] = deque()
        self._candado = threading.Lock()
        self._ultimo = 0.0
        self._pendiente: Optional[tuple[float, np.ndarray]] = None
        self._hay_pendiente = threading.Event()
        self._en_hilo = en_hilo
        self._hilo: Optional[threading.Thread] = None

    def ofrecer(self, cuadro: np.ndarray, hora: float) -> None:
        """Cuadro nuevo de la fuente (hilo de captura). Solo se guarda uno cada medio segundo; no debe
        modificarse después de entregarlo."""
        if hora - self._ultimo < self._intervalo:
            return
        self._ultimo = hora
        if not self._en_hilo:
            self._guardar(hora, cuadro)
            return
        with self._candado:
            self._pendiente = (hora, cuadro)
            if self._hilo is None:
                self._hilo = threading.Thread(target=self._trabajar, daemon=True, name="ANPR-Historial")
                self._hilo.start()
        self._hay_pendiente.set()

    def _trabajar(self) -> None:
        while True:
            self._hay_pendiente.wait()
            self._hay_pendiente.clear()
            with self._candado:
                pendiente, self._pendiente = self._pendiente, None
            if pendiente is not None:
                self._guardar(*pendiente)

    def _guardar(self, hora: float, cuadro: np.ndarray) -> None:
        guardado = comprimir(cuadro, hora)
        if guardado is None:
            return
        with self._candado:
            self._cuadros.append(guardado)
            while self._cuadros and hora - self._cuadros[0].hora > self._segundos:
                self._cuadros.popleft()

    def miniaturas(self) -> list[tuple[float, bytes]]:
        """(hora, miniatura JPEG) de los cuadros guardados, del más reciente al más antiguo."""
        with self._candado:
            return [(c.hora, c.miniatura) for c in reversed(self._cuadros)]

    def foto(self, hora: float, tolerancia_s: float = 0.25) -> Optional[bytes]:
        """JPEG completo del cuadro guardado a esa hora (el más cercano, dentro de la tolerancia)."""
        with self._candado:
            cercano = min(self._cuadros, key=lambda c: abs(c.hora - hora), default=None)
        if cercano is None or abs(cercano.hora - hora) > tolerancia_s:
            return None
        return cercano.jpeg

    def reiniciar(self) -> None:
        """Olvida lo guardado (al cambiar de cámara: los cuadros serían de otra)."""
        with self._candado:
            self._cuadros.clear()
            self._pendiente = None
        self._ultimo = 0.0
