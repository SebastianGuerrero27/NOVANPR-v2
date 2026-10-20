"""Interpretación de lecturas OCR sin inventar caracteres (app/dominio/interpretacion_placa.py)."""

import pytest

from app.dominio.ecuador_plate_validator import EcuadorPlateValidator, formato_coherente_con_la_placa, validate_ecuadorian_plate
from app.dominio.interpretacion_placa import caracteres_sin_lectura_directa
from app.dominio.plate_parser import disambiguate_plate, extraer_placa, interpretar_lectura
from app.infraestructura.ocr_verifier import leer_lineas_placa


@pytest.mark.parametrize("texto, placa", [("PB1234", "PB-1234"), ("AB123A", "AB-123A"), ("AB123C", "AB-123C")])
def test_una_moto_leida_bien_no_se_convierte_en_otra_placa(texto, placa):
    """Antes se probaba primero el formato de auto y se forzaba: PB1234 → PBI-234, AB123A → ABI-234,
    en los tres lectores (agente, verificador y validador del motor)."""
    assert disambiguate_plate(texto) == placa
    resultado = EcuadorPlateValidator.validate(texto)
    assert (resultado.formatted_plate, resultado.correcciones) == (placa, ())
    assert resultado.tipo_vehiculo.startswith("Motocicleta")
    assert leer_lineas_placa([texto], [0.9])[0] == placa.replace("-", "")


def test_cada_sustitucion_queda_registrada():
    assert EcuadorPlateValidator.validate("PSYS89").correcciones == ((3, "S", "5"),)
    assert EcuadorPlateValidator.validate("DBA1234").correcciones == ((0, "D", "P"),)
    assert interpretar_lectura("P5Y589").correcciones == ((1, "5", "S"),)
    assert EcuadorPlateValidator.validate("PSY589").correcciones == ()


def test_sin_formato_posible_se_conserva_el_texto_leido():
    """Antes 'TRANS1' salía como 'TR-4N51', que no es ni la lectura ni una placa."""
    interpretacion = interpretar_lectura("trans-1")
    assert (interpretacion.crudo, interpretacion.placa, interpretacion.correcciones) == ("TRANS1", "", ())
    assert disambiguate_plate("TRANS1") == "TRANS1"
    assert validate_ecuadorian_plate("TRANS1")[0] is False


@pytest.mark.parametrize("texto", ["PSYS89", "P0A1234", "1AB987", "CC12345", "PBA12U4", "E12345"])
def test_la_interpretacion_no_agrega_ni_quita_caracteres(texto):
    """Antes una diplomática de 7 caracteres perdía el último (CC12345 → CC-1234)."""
    for placa in (disambiguate_plate(texto), EcuadorPlateValidator.disambiguate(texto)):
        assert len(placa.replace("-", "")) == len(texto)


def test_ante_un_empate_decide_la_prioridad_del_formato():
    # CC1234 encaja sin cambios como diplomática y como moto de Carchi: prima la diplomática
    assert EcuadorPlateValidator.validate("CC1234").tipo_vehiculo.startswith("Diplom")
    assert disambiguate_plate("CC1234") == "CC-1234"


def test_los_lectores_conservan_el_texto_del_que_sale_la_placa():
    assert extraer_placa(["ECUADOR", "P5Y", "589"]) == ("PSY-589", 1.0, "P5Y589")
    assert leer_lineas_placa(["P8A-12O4"], [0.8]) == ("PBA1204", 0.8, "P8A12O4")
    assert leer_lineas_placa(["ECUADOR", "ANT"], [0.9, 0.9]) == ("", 0.0, "")


def test_caracteres_sin_lectura_directa():
    # Todos los lectores vieron "S": el "5" solo existe por la sustitución
    assert caracteres_sin_lectura_directa("PSY-589", ["PSYS89", "PSYS89"]) == [(3, "5")]
    # Otro lector leyó el "5" tal cual: la sustitución queda respaldada
    assert caracteres_sin_lectura_directa("PSY-589", ["PSYS89", "PSY589"]) == []
    # Una lectura de otra longitud no respalda ninguna posición
    assert caracteres_sin_lectura_directa("PSY589", ["PSY5891"]) == list(enumerate("PSY589"))
    assert caracteres_sin_lectura_directa("PSY589", []) == list(enumerate("PSY589"))


@pytest.mark.parametrize("texto, tipo, servicio", [
    ("PEA1234", "Gubernamental", "Gobierno central"),
    ("PXA1234", "Uso oficial", "Uso oficial"),
    ("QMC5678", "GAD", "Gobierno Autónomo Descentralizado (GAD)"),
    ("GUA1234", "Comercial", "Comercial (taxis y buses)"),
    ("PSA1234", "Particular", "Particular"),
    ("PBA1234", "Particular", "Particular"),
])
def test_el_servicio_sigue_la_tabla_6_de_la_tesis(texto, tipo, servicio):
    """Misma tipificación que muestra la interfaz (frontend/src/dominio/tipificacion.ts)."""
    resultado = EcuadorPlateValidator.validate(texto)
    assert (resultado.tipo_vehiculo, resultado.servicio, resultado.is_valid) == (tipo, servicio, True)


def test_las_series_f_son_de_las_fuerzas_armadas_y_son_validas():
    resultado = EcuadorPlateValidator.validate("FAB1234")
    assert (resultado.tipo_vehiculo, resultado.is_valid, resultado.confidence_score) == ("Fuerzas Armadas", True, 1.0)


def test_la_forma_del_recuadro_descarta_lecturas_que_no_son_placas():
    """Moto en un recuadro de auto: texto que no es placa. Auto en un recuadro casi cuadrado: el
    adoquinado del piso de la garita (92 × 98 px leído SVT-584, 20-10-2026)."""
    assert not formato_coherente_con_la_placa("PO-0418", es_moto=False, aspecto=1.8)
    assert not formato_coherente_con_la_placa("SVT-584", es_moto=True, aspecto=0.94)
    assert not formato_coherente_con_la_placa("TBC-5822", es_moto=True, aspecto=1.0)
    assert formato_coherente_con_la_placa("AB-123C", es_moto=True, aspecto=1.0)       # placa de moto
    assert formato_coherente_con_la_placa("GVU-584", es_moto=True, aspecto=1.36)      # auto cerca, en ángulo
    assert formato_coherente_con_la_placa("SVT-584", es_moto=True)                    # sin la forma: como antes
