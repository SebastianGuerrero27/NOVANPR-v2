"""Abstención por evidencia textual independiente, sin diccionario de marcas."""

import math

import pytest

from app.dominio.texto_observado import es_texto_no_matricula


@pytest.mark.parametrize("texto", ["HAVAL / ambacar", "ÁMBACAR", "TEXTO LIBRE", "OTRO / ROTULO", "SEÑAL-LOCAL"])
def test_texto_alfabetico_seguro_sin_matricula_aporta_evidencia_negativa(texto):
    assert es_texto_no_matricula(texto, 0.95)


@pytest.mark.parametrize("texto", ["", "ABC", "ECUADOR", "ANT", "ECUADOR / ANT", "PBA 1234", "HAVAL / 2026", "ABC?DEF", "AB@CAR", "1234567"])
def test_cabeceras_lecturas_cortas_numericas_o_inciertas_no_vetan_la_placa(texto):
    assert not es_texto_no_matricula(texto, 0.99)


@pytest.mark.parametrize("confianza", [0.0, 0.89, -1.0, 1.1, math.nan, math.inf, None, "invalida"])
def test_la_incertidumbre_no_se_convierte_en_evidencia_negativa(confianza):
    assert not es_texto_no_matricula("TEXTO LIBRE", confianza)


def test_un_lector_que_si_leyo_matricula_no_es_vetado_por_otras_palabras():
    assert not es_texto_no_matricula("ECUADOR / PBAOOOO", 0.99, "PBA0000")
    assert not es_texto_no_matricula("HAVAL / ambacar", 0.99, "PBA1234")


def test_el_umbral_operativo_es_inclusivo():
    assert es_texto_no_matricula("TEXTO", 0.90)
