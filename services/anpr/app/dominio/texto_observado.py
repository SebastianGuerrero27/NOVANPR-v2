"""Evidencia textual abierta para abstenerse de inventar una matrícula.

Un OCR especializado siempre intenta leer una placa, incluso sobre un rótulo. Esta regla
solo usa una observación independiente, de alta confianza y exclusivamente alfabética.
No reconoce marcas ni consulta listas de vehículos. El umbral es una regla operativa,
no una probabilidad calibrada de que el objeto sea o no una placa.
"""

from __future__ import annotations

import math
import re
import unicodedata


CONFIANZA_MINIMA_TEXTO = 0.90
_CABECERAS = frozenset({"ECUADOR", "ANT"})


def es_texto_no_matricula(texto_observado: str, confianza_texto: float, placa_verificador: str = "") -> bool:
    """True si hay evidencia conservadora de texto libre, sin matrícula del segundo OCR.

    Un resultado vacío, incierto, numérico o con símbolos desconocidos no permite vetar
    al lector especializado. Una matrícula que el segundo OCR sí pudo interpretar
    prevalece aunque el recorte contenga también un rótulo o una cabecera.
    """
    if placa_verificador or not isinstance(texto_observado, str):
        return False
    try:
        confianza = float(confianza_texto)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(confianza) or not CONFIANZA_MINIMA_TEXTO <= confianza <= 1.0:
        return False
    normalizado = "".join(
        c for c in unicodedata.normalize("NFKD", texto_observado.upper())
        if not unicodedata.combining(c)
    )
    # Se toleran separadores entre los tokens observados; no se borran dígitos ni signos
    # inciertos para fabricar una observación puramente alfabética.
    letras = re.sub(r"[\s/|·,;:_\-]+", "", normalizado)
    if len(letras) < 4 or not letras.isalpha():
        return False
    palabras = re.split(r"[\s/|·,;:_\-]+", normalizado.strip())
    return any(palabra and palabra not in _CABECERAS for palabra in palabras)
