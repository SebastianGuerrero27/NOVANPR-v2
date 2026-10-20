"""
Pasos de vehículos sin placa visible (autos nuevos, motos que la llevan solo atrás, placas tapadas).

El flujo de placas no registra nada si no hay una placa que leer, y el vehículo pasaba sin dejar
evidencia. El vigilante observa el movimiento (MOG2) dentro de la zona de interés: un evento empieza
cuando una parte apreciable de la zona se mueve y termina tras un rato sin movimiento. Al cerrarse,
el motor espera a que el flujo de placas termine y, si no registró ningún paso, un detector de
vehículos (COCO) revisa los cuadros guardados del evento: solo un auto, moto, bus o camión dentro de
la zona se registra, con su foto como evidencia, para que el personal lo verifique.

Calibración con el video real de la garita (ENTRADA_ECU_001, 19-10-2026 07:40–08:10, 13 pasos,
detector de movimiento del motor a ~10 cuadros/s): la fracción de la zona en movimiento llegó a
0,64–0,91 con los autos y a 0,25 con la moto; el guardia caminando, a 0,03–0,07 y, muy cerca de la
cámara, a 0,25. El movimiento por sí solo no distingue a una persona cercana de una moto: por eso
decide el detector de vehículos y el umbral de movimiento (0,15) solo descarta lo evidente.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

#: Motivos que el motor envía como evidencia del paso (el backend los explica al personal)
MOTIVO_SIN_PLACA = "vehiculo_sin_placa"
#: Hubo una detección con forma de placa (p. ej. el emblema de un auto nuevo) pero ninguna lectura
MOTIVO_PLACA_NO_LEIDA = "placa_no_leida"


@dataclass(frozen=True)
class ParametrosSinPlaca:
    #: Fracción de la zona en movimiento que abre un evento
    fraccion_inicio: float = 0.04
    #: Fracción que lo mantiene abierto
    fraccion_sostener: float = 0.01
    #: Segundos por debajo de fraccion_sostener que lo cierran
    cierre_s: float = 1.5
    #: Máximo del evento para revisarlo (auto 0,64–0,91; moto 0,25; persona lejos ≤ 0,07)
    fraccion_vehiculo: float = 0.15
    #: Eventos más cortos son ruido (un reflejo, un ave). Con pocos cuadros analizados por segundo
    #: (≈ 3 en el portátil) una moto que cruza en 2 s deja 2 o 3 muestras: 0,8 s la dejaba fuera
    #: (19-10-2026); decide igual el detector de vehículos
    duracion_min_s: float = 0.3
    #: Cuadros con movimiento que exige el evento (un solo cuadro es un destello)
    muestras_min: int = 2
    #: Con movimiento sostenido (varios vehículos seguidos) el evento se corta y empieza otro
    duracion_max_s: float = 60.0
    #: Cuadros del evento que se guardan para el detector de vehículos y la evidencia
    cuadros_guardados: int = 3


@dataclass
class EventoMovimiento:
    """Evento cerrado que merece revisión: intervalo, intensidad y cuadros (hora, fracción, cuadro)."""
    inicio: float
    fin: float
    fraccion_max: float
    cuadros: list[tuple[float, float, np.ndarray]] = field(default_factory=list)
    #: Durante el evento el detector de placas vio algo con forma de placa (con confianza de registro)
    placa_vista: bool = False
    #: Cuadros analizados con movimiento durante el evento
    muestras: int = 1

    @property
    def duracion_s(self) -> float:
        return self.fin - self.inicio


class VigilanteSinPlaca:
    """Máquina de estados de los eventos de movimiento en la zona de interés (un hilo la alimenta)."""

    def __init__(self, parametros: Optional[ParametrosSinPlaca] = None,
                 al_descartar: Optional[Callable[[EventoMovimiento], None]] = None) -> None:
        self.p = parametros or ParametrosSinPlaca()
        #: Recibe los eventos que se cerraron sin merecer revisión (diagnóstico de los umbrales)
        self._al_descartar = al_descartar
        self._evento: Optional[EventoMovimiento] = None
        self._ultimo_movimiento = 0.0

    def reiniciar(self) -> None:
        """Olvida el evento en curso (al cambiar de cámara o de zonas)."""
        self._evento = None

    def _guardar(self, hora: float, fraccion: float, cuadro: Optional[np.ndarray]) -> None:
        """Conserva los cuadros de mayor movimiento del evento (una copia solo si entra entre los mejores)."""
        if cuadro is None or fraccion < self.p.fraccion_vehiculo:
            return
        cuadros = self._evento.cuadros
        if len(cuadros) >= self.p.cuadros_guardados:
            peor = min(range(len(cuadros)), key=lambda i: cuadros[i][1])
            # Solo si mejora claramente al peor guardado: evita copiar un cuadro 1080p en cada análisis
            if fraccion <= cuadros[peor][1] * 1.1:
                return
            cuadros.pop(peor)
        cuadros.append((hora, fraccion, cuadro.copy()))

    def alimentar(self, hora: float, fraccion: float, cuadro: Optional[np.ndarray] = None,
                  placa_vista: bool = False) -> Optional[EventoMovimiento]:
        """
        Fracción de la zona en movimiento del cuadro analizado a la `hora` (s) y si el detector de placas
        vio una placa en él. Devuelve el evento que se cerró en este cuadro si merece revisión
        (intensidad y duración suficientes), o None.
        """
        p = self.p
        cerrado: Optional[EventoMovimiento] = None
        if self._evento is not None:
            if fraccion >= p.fraccion_sostener:
                self._ultimo_movimiento = hora
                self._evento.fin = hora
                self._evento.muestras += 1
            vencido = hora - self._evento.inicio >= p.duracion_max_s
            if hora - self._ultimo_movimiento > p.cierre_s or vencido:
                cerrado, self._evento = self._evento, None
            else:
                self._evento.fraccion_max = max(self._evento.fraccion_max, fraccion)
                self._evento.placa_vista = self._evento.placa_vista or placa_vista
                self._guardar(hora, fraccion, cuadro)
        if self._evento is None and cerrado is None and fraccion >= p.fraccion_inicio:
            self._evento = EventoMovimiento(inicio=hora, fin=hora, fraccion_max=fraccion, placa_vista=placa_vista)
            self._ultimo_movimiento = hora
            self._guardar(hora, fraccion, cuadro)
        if cerrado is None:
            return None
        if (cerrado.fraccion_max >= p.fraccion_vehiculo and cerrado.duracion_s >= p.duracion_min_s
                and cerrado.muestras >= p.muestras_min and cerrado.cuadros):
            return cerrado
        if self._al_descartar is not None:
            self._al_descartar(cerrado)
        return None
