"""
Seguimiento de la caja de cada placa en todos los cuadros de la fuente, no solo en los que analiza
el detector.

El detector analiza pocos cuadros por segundo (en un portátil sin GPU, unos 3 de 30) y su
resultado llega cuando el video ya avanzó varios cuadros. Entre dos análisis la caja del HUD
quedaba quieta y saltaba al llegar el siguiente: no acompañaba el movimiento real de la placa.

Aquí cada cuadro nuevo mueve la caja con flujo óptico (Lucas-Kanade piramidal con verificación de
ida y vuelta) sobre las esquinas de la placa, que tiene mucha textura (los caracteres): traslación
y escala por la mediana de los puntos que se siguen bien. Cuando llega un análisis, su caja (válida
en el cuadro analizado) se lleva hasta el cuadro actual con los últimos cuadros guardados, y desde
ahí se sigue cuadro a cuadro; así el detector corrige la deriva en cada análisis. Los cuadros se
guardan tal como llegan (el lector entrega una copia nueva de cada uno) y solo se pasa a gris el
recorte alrededor de cada placa: sin placas a la vista el seguidor no gasta CPU. Si la placa pierde
textura (borrosa, tapada), la caja avanza unos cuadros con su última velocidad y luego se detiene.

Solo mueve el dibujo: el reconocimiento (detector, seguimiento ByteTrack, OCR) no cambia.
"""
from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass, replace
from typing import Optional

import cv2
import numpy as np

Caja = tuple[float, float, float, float]
Puntos = Optional[list[tuple[float, float]]]

#: Cuadros guardados para llevar un análisis hasta el cuadro actual: 1,5 s a 30 fps. Con la CPU
#: ocupada por el OCR durante una pasada, un análisis llegó 19 cuadros tarde (0,63 s); con 16
#: guardados su cuadro ya no estaba y la caja quedaba donde la vio el detector, detrás de la placa.
#: Son referencias a los cuadros que entrega el lector (~6 MB cada uno en 1080p), no copias.
CUADROS_GUARDADOS = 45
#: Cuadros seguidos sin puntos fiables en los que la caja avanza con su última velocidad
MAX_CUADROS_A_CIEGAS = 6
_MIN_PUNTOS = 4
_ERROR_IDA_VUELTA_PX = 1.0
_ESCALA_MAX_POR_CUADRO = 0.1
_LK = dict(winSize=(21, 21), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03))


@dataclass(frozen=True)
class CajaSeguida:
    """Caja (x1, y1, x2, y2) y cuadrilátero de la placa en píxeles, válidos en el cuadro `indice`."""
    caja: Caja
    puntos: Puntos
    #: Velocidad del centro en píxeles por segundo, medida por el flujo
    velocidad: tuple[float, float]
    indice: int
    hora: float
    a_ciegas: int = 0


@dataclass(frozen=True)
class _Cuadro:
    indice: int
    hora: float
    imagen: np.ndarray


def _gris(recorte: np.ndarray) -> np.ndarray:
    return recorte if recorte.ndim == 2 else cv2.cvtColor(recorte, cv2.COLOR_BGR2GRAY)


def flujo_placa(previo: np.ndarray, actual: np.ndarray, caja: Caja) -> Optional[tuple[float, float, float]]:
    """(dx, dy, escala) de la placa entre dos cuadros (en color o en gris), o None si no hay
    puntos fiables."""
    alto, ancho = previo.shape[:2]
    x1, y1, x2, y2 = caja
    w, h = x2 - x1, y2 - y1
    if w < 8 or h < 4:
        return None
    # Recorte con margen para el desplazamiento: el flujo solo mira alrededor de la placa
    m = max(w, 48.0)
    rx1, ry1 = int(max(0, x1 - m)), int(max(0, y1 - m))
    rx2, ry2 = int(min(ancho, x2 + m)), int(min(alto, y2 + m))
    mx1, my1 = int(max(0, x1 - rx1)), int(max(0, y1 - ry1))
    mx2, my2 = int(min(rx2, x2) - rx1), int(min(ry2, y2) - ry1)
    if mx2 - mx1 < 4 or my2 - my1 < 3:
        return None
    r0, r1 = _gris(previo[ry1:ry2, rx1:rx2]), _gris(actual[ry1:ry2, rx1:rx2])
    mascara = np.zeros_like(r0)
    mascara[my1:my2, mx1:mx2] = 255
    p0 = cv2.goodFeaturesToTrack(r0, maxCorners=40, qualityLevel=0.01, minDistance=3, mask=mascara, blockSize=3)
    if p0 is None or len(p0) < _MIN_PUNTOS:
        return None
    p1, st, _ = cv2.calcOpticalFlowPyrLK(r0, r1, p0, None, **_LK)
    if p1 is None:
        return None
    pv, st_v, _ = cv2.calcOpticalFlowPyrLK(r1, r0, p1, None, **_LK)
    if pv is None:
        return None
    ida_vuelta = np.linalg.norm((p0 - pv).reshape(-1, 2), axis=1)
    buenos = (st.reshape(-1) == 1) & (st_v.reshape(-1) == 1) & (ida_vuelta < _ERROR_IDA_VUELTA_PX)
    if int(buenos.sum()) < _MIN_PUNTOS:
        return None
    a, b = p0.reshape(-1, 2)[buenos], p1.reshape(-1, 2)[buenos]
    dx, dy = np.median(b - a, axis=0)
    # Escala por las distancias al centro de cada nube: la placa crece al acercarse el vehículo
    da = np.linalg.norm(a - a.mean(axis=0), axis=1)
    db = np.linalg.norm(b - b.mean(axis=0), axis=1)
    lejos = da > 2.0
    escala = float(np.median(db[lejos] / da[lejos])) if int(lejos.sum()) >= 3 else 1.0
    escala = float(np.clip(escala, 1 - _ESCALA_MAX_POR_CUADRO, 1 + _ESCALA_MAX_POR_CUADRO))
    return float(dx), float(dy), escala


def _transformar(caja: Caja, puntos: Puntos, dx: float, dy: float, escala: float, forma: tuple) -> tuple[Caja, Puntos]:
    alto, ancho = forma[:2]
    cx, cy = (caja[0] + caja[2]) / 2, (caja[1] + caja[3]) / 2
    nx, ny = cx + dx, cy + dy
    mw, mh = (caja[2] - caja[0]) * escala / 2, (caja[3] - caja[1]) * escala / 2
    nueva = (max(0.0, nx - mw), max(0.0, ny - mh), min(float(ancho), nx + mw), min(float(alto), ny + mh))
    if puntos is None:
        return nueva, None
    return nueva, [(nx + (px - cx) * escala, ny + (py - cy) * escala) for px, py in puntos]


def mover(pista: CajaSeguida, previo: _Cuadro, actual: _Cuadro) -> CajaSeguida:
    """La caja de `previo` llevada a `actual` por el flujo óptico (o por su velocidad, a ciegas)."""
    dt = max(1e-3, actual.hora - previo.hora)
    medido = flujo_placa(previo.imagen, actual.imagen, pista.caja)
    if medido is None:
        if pista.a_ciegas >= MAX_CUADROS_A_CIEGAS:
            return replace(pista, velocidad=(0.0, 0.0), indice=actual.indice, hora=actual.hora, a_ciegas=pista.a_ciegas + 1)
        dx, dy, escala = pista.velocidad[0] * dt, pista.velocidad[1] * dt, 1.0
        velocidad, a_ciegas = pista.velocidad, pista.a_ciegas + 1
    else:
        dx, dy, escala = medido
        velocidad = (0.5 * pista.velocidad[0] + 0.5 * dx / dt, 0.5 * pista.velocidad[1] + 0.5 * dy / dt)
        a_ciegas = 0
    caja, puntos = _transformar(pista.caja, pista.puntos, dx, dy, escala, actual.imagen.shape)
    return CajaSeguida(caja, puntos, velocidad, actual.indice, actual.hora, a_ciegas)


def _distancia_en_anchos(a: Caja, b: Caja) -> float:
    """Distancia entre los centros de dos cajas, en anchos de la segunda."""
    dx = (a[0] + a[2]) / 2 - (b[0] + b[2]) / 2
    dy = (a[1] + a[3]) / 2 - (b[1] + b[3]) / 2
    return float(np.hypot(dx, dy)) / max(1.0, b[2] - b[0])


def _poner_al_dia(pista: CajaSeguida, cuadros: list[_Cuadro]) -> CajaSeguida:
    previo = None
    for cuadro in cuadros:
        if previo is not None and previo.indice == pista.indice and cuadro.indice > pista.indice:
            pista = mover(pista, previo, cuadro)
        previo = cuadro
    return pista


class SeguidorFlujo:
    """Cajas del HUD al día con cada cuadro. `avanzar` se llama con cada cuadro nuevo de la fuente
    (hilo de captura) y `anclar` con el resultado de cada análisis (hilo de detección)."""

    def __init__(self, cuadros_guardados: int = CUADROS_GUARDADOS) -> None:
        self._cuadros: deque[_Cuadro] = deque(maxlen=cuadros_guardados)
        self._pistas: dict[int, CajaSeguida] = {}
        self._candado = threading.Lock()
        # Telemetría para /status: cuánto tarda cada análisis en cuadros, si su cuadro seguía
        # guardado, en qué cuadros funcionó el flujo y cuánto se corrigió la caja al anclarla
        self._anclas = 0
        self._fuera_de_lo_guardado = 0
        self._retraso: deque[int] = deque(maxlen=300)
        self._correccion: deque[float] = deque(maxlen=300)
        self._con_flujo: deque[bool] = deque(maxlen=2000)

    def avanzar(self, frame: np.ndarray, indice: int, hora: float) -> None:
        """Cuadro nuevo de la fuente. Se guarda sin copiarlo: no debe modificarse después."""
        actual = _Cuadro(indice, hora, frame)
        with self._candado:
            previo = self._cuadros[-1] if self._cuadros else None
            self._cuadros.append(actual)
            if previo is None:
                return
            for tid, pista in list(self._pistas.items()):
                if pista.indice == previo.indice:
                    movida = mover(pista, previo, actual)
                    self._con_flujo.append(movida.a_ciegas == 0)
                    if movida.caja[2] - movida.caja[0] < 4 or movida.caja[3] - movida.caja[1] < 2:
                        # La placa salió del cuadro
                        del self._pistas[tid]
                    else:
                        self._pistas[tid] = movida

    def anclar(self, cajas: dict[int, tuple], indice: int, hora: float) -> None:
        """Posiciones del detector en el cuadro `indice` ((caja, puntos) o (caja, puntos, predicha)),
        llevadas hasta el último cuadro recibido. Las pistas que no vienen dejan de seguirse: el
        detector ya no las muestra. Una caja predicha (el detector no vio la placa en ese análisis,
        es la predicción del Kalman) no reemplaza a la que el flujo ya seguía: el flujo mide el
        movimiento de la placa y la predicción solo lo supone."""
        with self._candado:
            tramo = [c for c in self._cuadros if c.indice >= indice]
            previas = dict(self._pistas)
            if cajas:
                self._anclas += 1
                if self._cuadros:
                    self._retraso.append(self._cuadros[-1].indice - indice)
                if not tramo or tramo[0].indice != indice:
                    self._fuera_de_lo_guardado += 1
        guardado = bool(tramo) and tramo[0].indice == indice
        nuevas: dict[int, CajaSeguida] = {}
        for tid, (caja, puntos, *resto) in cajas.items():
            previa = previas.get(tid)
            if previa is not None and resto and resto[0]:
                nuevas[tid] = previa
                continue
            if not guardado:
                # El cuadro analizado ya no está guardado (análisis muy lento): su caja es de hace
                # demasiado y ponerla en el cuadro actual la dejaría detrás de la placa. La pista que
                # ya se seguía conserva su caja; una nueva espera al próximo análisis
                if previa is not None:
                    nuevas[tid] = previa
                continue
            pista = CajaSeguida(tuple(float(v) for v in caja), puntos, previa.velocidad if previa else (0.0, 0.0), indice, hora)
            nuevas[tid] = _poner_al_dia(pista, tramo)
        with self._candado:
            # Cuadros que llegaron mientras se ponían al día
            ultimo = tramo[-1].indice if tramo else indice
            restantes = [c for c in self._cuadros if c.indice >= ultimo]
            al_dia = {tid: _poner_al_dia(p, restantes) for tid, p in nuevas.items()}
            for tid, p in al_dia.items():
                previa = self._pistas.get(tid)
                if previa is not None and previa.indice == p.indice:
                    self._correccion.append(_distancia_en_anchos(previa.caja, p.caja))
            self._pistas = al_dia

    def estadisticas(self) -> dict:
        """Para /status: retraso de los análisis (cuadros), análisis cuyo cuadro ya no estaba
        guardado, cuadros en que el flujo siguió la placa y corrección al anclar (en anchos de placa:
        cuánto se había desviado la caja entre dos análisis)."""
        with self._candado:
            retraso, correccion = sorted(self._retraso), sorted(self._correccion)
            con_flujo, anclas, fuera = list(self._con_flujo), self._anclas, self._fuera_de_lo_guardado

        def q(v: list, p: float):
            return v[min(len(v) - 1, int(round(p * (len(v) - 1))))] if v else None

        return {
            "anclas": anclas,
            "analisis_fuera_de_lo_guardado": fuera,
            "retraso_analisis_cuadros": {"p50": q(retraso, 0.5), "p95": q(retraso, 0.95)},
            "cuadros_con_flujo_pct": round(100 * sum(con_flujo) / len(con_flujo), 1) if con_flujo else None,
            "correccion_al_anclar_anchos": {
                "p50": round(q(correccion, 0.5), 2) if correccion else None,
                "p95": round(q(correccion, 0.95), 2) if correccion else None,
            },
        }

    def pistas(self) -> dict[int, CajaSeguida]:
        with self._candado:
            return dict(self._pistas)

    def reiniciar(self) -> None:
        with self._candado:
            self._cuadros.clear()
            self._pistas.clear()
