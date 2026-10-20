"""
Un vehículo, un paso: consolidación de las pistas que el seguimiento parte en varias.

Con pocos cuadros analizados por segundo (≈ 3 en el portátil de desarrollo) el seguimiento pierde la
placa mientras el vehículo se acerca y crea una pista nueva, que volvía a registrar el mismo paso
con otra lectura. En el video real de la garita (19-10-2026) eso dio 19 registros para 12 vehículos:
PER-6147 y PFR-6147, PYL-512 y PXL-512, cuatro lecturas del mismo auto en 6 s.

Una pista nueva es el mismo paso que uno registrado (o en registro) en la misma cámara si:
  - continúa a la registrada: aparece a lo sumo `hueco_s` después de su última vista, cerca de donde
    se perdió (`distancia` del ancho del cuadro) y con una placa de tamaño parecido, o
  - su placa es casi igual (a lo sumo 2 ediciones: E/F, X/Y, un carácter de más o de menos) dentro
    de `ventana_s`.
Si la pista nueva lee mejor, corrige el registro existente en lugar de crear otro. Dos vehículos
seguidos no se confunden: el siguiente aparece lejos, con una placa mucho más pequeña que la del
anterior al perderse, o varios segundos después; dos placas a la vista al mismo tiempo son dos
vehículos.

Calibración (quinta pasada del video, 20-10-2026): las 8 pistas que se tomaron por otro paso eran del
mismo vehículo. Cuatro se solapaban 0,9–2,5 s con la anterior, por las cajas predichas por Kalman
que se contaban como vistas (ya no cuentan); las otras reaparecían a 360–819 px, porque una placa
cercana recorre mucho cuadro entre dos análisis: el límite de 0,25 del ancho (480 px) era corto.

Qué lectura es mejor (segunda prueba con el video, 20-10-2026): los vehículos se acercan a la cámara
y la pista lejana (placa de ~40 px) leía FSR-0147, PDD-438 o TEN-394, mientras la cercana leía
PFR-6147, PDO-418 y TBN-3950. La marca «válida» no las distinguía: depende sobre todo de cuántas
lecturas alcanzó a juntar la pista, y la cercana se consolida en la primera. Decide el tamaño de la
placa, siempre que la lectura nueva sea legible: el adoquinado del piso (recuadro de 92 × 98 px con
2 caracteres) se leyó SVT-584 y reemplazó a SVU-584.

Las placas de los ejemplos son ficticias: reemplazan a las del video (datos personales) y conservan
sus confusiones de lectura.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence


@dataclass(frozen=True)
class ParametrosConsolidacion:
    hueco_s: float = 2.5
    distancia: float = 0.45
    #: Ancho de la placa al reaparecer / al perderse que admite la continuación
    proporcion_ancho: tuple[float, float] = (0.5, 3.0)
    ventana_s: float = 20.0
    diferencias_max: int = 2
    #: La placa nueva lee mejor si es al menos esta proporción más ancha (más cerca de la cámara)
    proporcion_mas_cerca: float = 1.25
    #: Caracteres que exige la fila de la foto para corregir una lectura con ella
    caracteres_min: int = 5


@dataclass
class Vista:
    """Primera y última vez que se vio la placa de una pista: (hora, caja x1 y1 x2 y2)."""
    primera: float
    caja_primera: Sequence[float]
    ultima: float
    caja_ultima: Sequence[float]


@dataclass
class PasoReciente:
    tracking_id: int
    #: 0 mientras el registro está en curso (el backend aún no devuelve el id del ingreso)
    ingreso_id: int
    camara: int
    placa: str
    valida: bool
    ancho_placa: float
    confianza: float
    hora: float
    #: Pista cuya lectura corrigió el registro: la reevaluación tardía de la pista original ya no
    #: reemplaza la placa
    corregida_por: Optional[int] = None


def _ediciones(a: str, b: str) -> int:
    """Distancia de Levenshtein (sustituciones, inserciones y supresiones)."""
    previa = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        actual = [i]
        for j, y in enumerate(b, 1):
            actual.append(min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (x != y)))
        previa = actual
    return previa[-1]


def casi_iguales(a: str, b: str, diferencias_max: int = 2) -> bool:
    """Placas de al menos 6 caracteres que difieren en a lo sumo `diferencias_max` ediciones
    (PER6147 y PFR6147; PFR614 y PFR6147, con un dígito que la foto lejana no alcanzó a leer). No se
    admiten más: en una misma ciudad muchas placas comparten las letras (TBA, TBG…) y unir dos
    vehículos distintos es peor que duplicar uno."""
    return min(len(a), len(b)) >= 6 and a != b and _ediciones(a, b) <= diferencias_max


def _centro(caja: Sequence[float]) -> tuple[float, float]:
    return (caja[0] + caja[2]) / 2.0, (caja[1] + caja[3]) / 2.0


def _ancho(caja: Sequence[float]) -> float:
    return float(caja[2] - caja[0])


def continua(vista_nueva: Vista, vista_previa: Vista, ancho_cuadro: float, p: ParametrosConsolidacion) -> bool:
    """La pista nueva aparece poco después y cerca de donde se perdió la anterior."""
    hueco = vista_nueva.primera - vista_previa.ultima
    if not -0.5 <= hueco <= p.hueco_s or vista_nueva.primera < vista_previa.primera:
        return False
    proporcion = _ancho(vista_nueva.caja_primera) / max(1.0, _ancho(vista_previa.caja_ultima))
    if not p.proporcion_ancho[0] <= proporcion <= p.proporcion_ancho[1]:
        return False
    (xa, ya), (xb, yb) = _centro(vista_previa.caja_ultima), _centro(vista_nueva.caja_primera)
    return ((xa - xb) ** 2 + (ya - yb) ** 2) ** 0.5 <= p.distancia * ancho_cuadro


def mismo_paso(tracking_id: int, placa: str, camara: int, ahora: float, vistas: dict[int, Vista],
               pasos: Sequence[PasoReciente], ancho_cuadro: float,
               p: Optional[ParametrosConsolidacion] = None) -> Optional[PasoReciente]:
    """El paso registrado al que corresponde la pista nueva (el más reciente), o None si es otro vehículo."""
    p = p or ParametrosConsolidacion()
    vista = vistas.get(tracking_id)
    for paso in reversed(pasos):
        if paso.camara != camara or paso.tracking_id == tracking_id or ahora - paso.hora > p.ventana_s:
            continue
        if casi_iguales(paso.placa, placa, p.diferencias_max):
            return paso
        previa = vistas.get(paso.tracking_id)
        # En los dos sentidos: la pista más antigua puede llegar a registrarse después que la que la
        # continúa (paso 1 del video, 20-10-2026: los tracks #479 y #480 se registraron a la vez)
        if vista is not None and previa is not None and (
                continua(vista, previa, ancho_cuadro, p) or continua(previa, vista, ancho_cuadro, p)):
            return paso
    return None


def paso_mas_cercano(tracking_id: int, camara: int, ahora: float, vistas: dict[int, Vista],
                     pasos: Sequence[PasoReciente], p: Optional[ParametrosConsolidacion] = None
                     ) -> Optional[tuple[PasoReciente, float, float, float]]:
    """Diagnóstico de una pista que se tomó por otro paso: el paso más reciente de la cámara dentro de
    la ventana, con el hueco (s) entre sus vistas, la distancia (px) entre donde se perdió uno y
    apareció el otro, y la proporción entre sus anchos de placa. None si no hay paso reciente o faltan
    las vistas."""
    p = p or ParametrosConsolidacion()
    vista = vistas.get(tracking_id)
    for paso in reversed(pasos):
        if paso.camara != camara or paso.tracking_id == tracking_id or ahora - paso.hora > p.ventana_s:
            continue
        previa = vistas.get(paso.tracking_id)
        if vista is None or previa is None:
            return None
        antes, despues = (previa, vista) if previa.primera <= vista.primera else (vista, previa)
        (xa, ya), (xb, yb) = _centro(antes.caja_ultima), _centro(despues.caja_primera)
        return (paso, despues.primera - antes.ultima, ((xa - xb) ** 2 + (ya - yb) ** 2) ** 0.5,
                _ancho(despues.caja_primera) / max(1.0, _ancho(antes.caja_ultima)))
    return None


def lectura_legible(caracteres: int, inferidos: int, p: Optional[ParametrosConsolidacion] = None) -> bool:
    """La foto muestra una fila de caracteres y la lectura no necesitó inferir ninguno por el formato."""
    p = p or ParametrosConsolidacion()
    return caracteres >= p.caracteres_min and inferidos == 0


def lee_mejor(valida: bool, ancho_placa: float, confianza: float, legible: bool, paso: PasoReciente,
              p: Optional[ParametrosConsolidacion] = None) -> bool:
    """La lectura nueva es preferible a la registrada: solo si es legible; entonces la placa
    claramente más grande (más cerca de la cámara, más píxeles por carácter) y, con un tamaño
    parecido, la lectura válida y luego la de más confianza."""
    p = p or ParametrosConsolidacion()
    if not legible:
        return False
    if ancho_placa >= p.proporcion_mas_cerca * paso.ancho_placa:
        return True
    if paso.ancho_placa >= p.proporcion_mas_cerca * ancho_placa:
        return False
    return (valida, confianza) > (paso.valida, paso.confianza)
