"""La forma de matrícula no sustituye a la confianza visual del OCR."""
import numpy as np
import pytest

from app.aplicacion.plate_agent import PlateEnhancementAgent, confianza_visual
from app.infraestructura.ocr_engine import OcrResult


def resultado(texto, confianza):
    return OcrResult(texto, confianza, [])


@pytest.mark.parametrize("confianza", [0.11, 0.57, 0.96])
def test_el_formato_no_eleva_la_confianza_a_cien(confianza):
    class Motor:
        def read_text(self, imagen):
            return [resultado("PBA1234", confianza)]

    agente = PlateEnhancementAgent(Motor(), use_learned_rectifier=False)
    agente._rectify_quadrilateral = lambda imagen: imagen
    lectura = agente.process_image(np.full((70, 200, 3), 180, np.uint8))
    assert lectura.placa == "PBA-1234"
    assert lectura.confianza == confianza
    assert lectura.estado == ("procesado" if confianza >= 0.22 else "no_legible")


def test_fragmento_incierto_no_se_oculta_con_la_confianza_de_otro():
    tokens = [resultado("ECUADOR", 0.1), resultado("PBA", 0.99), resultado("1234", 0.46)]
    assert confianza_visual(tokens, "PBA1234") == 0.46


def test_token_elegido_no_hereda_confianza_de_texto_ajeno():
    assert confianza_visual([resultado("PBA1234", 0.8), resultado("OTRO", 0.1)], "PBA1234") == 0.8


@pytest.mark.parametrize("valor", [float("nan"), float("inf"), -0.1])
def test_puntuaciones_no_validas_no_generan_confianza(valor):
    assert confianza_visual([resultado("PBA1234", valor)], "PBA1234") == 0.0
