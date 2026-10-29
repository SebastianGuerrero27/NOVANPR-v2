"""El segundo OCR conserva texto libre sin alterar su interpretación de matrículas."""

import threading
from types import SimpleNamespace

import numpy as np
import pytest

from app.infraestructura.ocr_verifier import PlateOcrVerifier, VerifierResult, observar_texto


def _verificador(textos, scores, boxes=None):
    verificador = PlateOcrVerifier.__new__(PlateOcrVerifier)
    verificador._lock = threading.Lock()
    verificador._ocr = lambda imagen: SimpleNamespace(txts=textos, scores=scores, boxes=boxes)
    verificador.max_ms = 2000
    return verificador


def test_el_rotulo_no_se_pierde_al_no_tener_formato_de_placa():
    lectura = _verificador(["ambacar", "HAVAL"], [0.99662, 0.98753]).read(np.zeros((60, 180, 3), np.uint8))
    assert (lectura.plate, lectura.raw, lectura.confidence) == ("", "", 0.0)
    assert lectura.texto_observado == "ambacar / HAVAL"
    assert lectura.confianza_texto == 0.98753


def test_orden_visual_y_tokens_originales_se_conservan_en_la_observacion():
    cajas = [
        [[65, 10], [160, 10], [160, 45], [65, 45]],
        [[0, 15], [50, 15], [50, 40], [0, 40]],
    ]
    lectura = _verificador(["ambacar", "HAVAL"], [0.99662, 0.98753], cajas).read(np.zeros((60, 180, 3), np.uint8))
    assert lectura.texto_observado == "HAVAL / ambacar"
    assert lectura.confianza_texto == 0.98753


def test_la_observacion_no_cambia_la_matricula_ni_su_confianza():
    lectura = _verificador(["ECUADOR", "PBA-1234"], [0.99, 0.93]).read(np.zeros((60, 180, 3), np.uint8))
    assert (lectura.plate, lectura.raw, lectura.confidence) == ("PBA1234", "PBA1234", 0.93)
    assert lectura.texto_observado == "ECUADOR / PBA-1234"
    assert lectura.confianza_texto == 0.93


@pytest.mark.parametrize("scores", [[], [None], [float("nan")], [1.1], [-0.1]])
def test_puntuaciones_ausentes_o_invalidas_no_fabrican_confianza(scores):
    assert observar_texto(None, ["ambacar"], scores) == ("ambacar", 0.0)


def test_textos_sin_caja_no_se_descartan_por_un_proveedor_incompleto():
    assert observar_texto([], ["HAVAL", "ambacar"], [0.98, 0.99]) == ("HAVAL / ambacar", 0.98)


def test_los_tokens_vacios_no_ensucian_la_observacion():
    assert observar_texto(None, ["", None, "HAVAL"], [0.0, 0.0, 0.98]) == ("HAVAL", 0.98)
    assert observar_texto(None, [], []) == ("", 0.0)
    cajas = [
        [[0, 0], [20, 0], [20, 20], [0, 20]],
        [[25, 0], [80, 0], [80, 20], [25, 20]],
    ]
    assert observar_texto(cajas, ["", "HAVAL"], [0.0, 0.98]) == ("HAVAL", 0.98)


def test_los_nuevos_campos_son_compatibles_con_resultados_previos():
    resultado = VerifierResult("PBA1234", 0.9, 12.0, True, "PBA1234")
    assert (resultado.texto_observado, resultado.confianza_texto) == ("", 0.0)
