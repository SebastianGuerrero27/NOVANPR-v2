"""Métricas de abstención con negativos explícitos; sin cargar modelos OCR."""
import importlib.util
from pathlib import Path
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/evaluar_ocr_selectivo.py"
SPEC = importlib.util.spec_from_file_location("evaluar_ocr_selectivo", SCRIPT)
evaluacion = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = evaluacion
SPEC.loader.exec_module(evaluacion)
Caso, Prediccion = evaluacion.Caso, evaluacion.Prediccion


def test_negativos_no_se_excluyen_y_riesgo_penaliza_matricula_inventada():
    casos = [Caso("p.jpg", "ABC1234", "placa"), Caso("r.jpg", "", "texto", "marca")]
    predicciones = [Prediccion("ABC-1234", True, 10), Prediccion("QIH6060", True, 20)]
    r = evaluacion.resumir(casos, predicciones)
    assert r["exactitud_bruta_positivos"] == 1
    assert r["falsas_aceptaciones_negativos"] == 1
    assert r["tasa_falsa_aceptacion_negativos"] == 1
    assert r["riesgo_selectivo_global"] == 0.5
    assert r["latencia_ms"] == {"muestras": 2, "p50": 15, "p95": 19.5}


def test_abstencion_no_se_cuenta_como_acierto_ni_como_falsa_aceptacion():
    casos = [Caso("a", "ABC1234", "placa"), Caso("b", "DEF5678", "placa"), Caso("r", "", "texto")]
    pred = [Prediccion("ABC1234", True, 10), Prediccion("DEF5678", False, 20), Prediccion("QIH6060", False, 30)]
    r = evaluacion.resumir(casos, pred)
    assert r["exactitud_bruta_positivos"] == 1
    assert r["exactitud_aceptada_positivos"] == 0.5
    assert r["exactitud_condicional_aceptadas_positivos"] == 1
    assert r["cobertura_positivos"] == 0.5
    assert r["cobertura_global"] == pytest.approx(1 / 3)
    assert r["riesgo_selectivo_global"] == 0
    assert r["cer_propuesta_positivos"] == 0
    assert r["cer_salida_positivos"] == 0.5
    assert r["tasa_falsa_aceptacion_negativos"] == 0


def test_sin_positivos_o_aceptaciones_se_retorna_null_y_no_un_cien_por_ciento():
    r = evaluacion.resumir([Caso("r", "", "texto")], [Prediccion("", False, 12)])
    assert r["exactitud_bruta_positivos"] is None
    assert r["cobertura_positivos"] is None
    assert r["cer_salida_positivos"] is None
    assert r["riesgo_selectivo_global"] is None
    assert r["tasa_falsa_aceptacion_negativos"] == 0


def test_cer_es_micro_promedio_y_lecturas_vacias_cuentan_caracteres_perdidos():
    r = evaluacion.resumir([Caso("a", "ABC1234", "placa"), Caso("b", "DEF5678", "placa")],
                          [Prediccion("ABC1235", True, 1), Prediccion("", False, 1)])
    assert r["cer_propuesta_positivos"] == pytest.approx(8 / 14)
    assert r["riesgo_selectivo_global"] == 1
    assert r["tasa_falsa_aceptacion_negativos"] is None


@pytest.mark.parametrize("pred", [[], [Prediccion("", True, 1)], [Prediccion("ABC1234", True, float("nan"))]])
def test_rechaza_resultados_incompletos_salida_vacia_aceptada_o_tiempos_invalidos(pred):
    with pytest.raises(ValueError):
        evaluacion.resumir([Caso("a", "ABC1234", "placa")], pred)


def test_manifest_conserva_negativos_y_anotacion_humana(tmp_path):
    (tmp_path / "rotulo.png").write_bytes(b"image")
    manifest = tmp_path / "etiquetas.csv"
    manifest.write_text("archivo,placa,tipo,texto_observado,grupo\nrotulo.png,,texto,HAVAL / ambacar,desarrollo\n", encoding="utf-8")
    casos = evaluacion.leer_manifest(manifest, tmp_path)
    assert casos == [Caso("rotulo.png", "", "texto", "HAVAL / ambacar", "desarrollo")]


@pytest.mark.parametrize("linea", ["x.png,,placa", "x.png,ABC1234,texto", "x.png,,ignorado", "../x.png,,texto", "ausente.png,,texto"])
def test_manifest_rechaza_etiquetas_ambiguas_y_no_saltea_imagenes_faltantes(tmp_path, linea):
    (tmp_path / "x.png").write_bytes(b"image")
    manifest = tmp_path / "etiquetas.csv"
    manifest.write_text("archivo,placa,tipo\n" + linea + "\n", encoding="utf-8")
    with pytest.raises(ValueError):
        evaluacion.leer_manifest(manifest, tmp_path)


def test_manifest_repetido_no_infla_muestras(tmp_path):
    (tmp_path / "x.png").write_bytes(b"image")
    manifest = tmp_path / "etiquetas.csv"
    manifest.write_text("archivo,placa,tipo\nx.png,,texto\nx.png,,texto\n", encoding="utf-8")
    with pytest.raises(ValueError, match="duplicada"):
        evaluacion.leer_manifest(manifest, tmp_path)


def test_inventario_hashes_modelo_real_y_pesos_xml(tmp_path):
    xml = tmp_path / "modelo.xml"
    pesos = tmp_path / "modelo.bin"
    xml.write_bytes(b"xml")
    pesos.write_bytes(b"bin")
    resultado = evaluacion.inventario_modelos([{"model_path": xml}])
    assert {Path(r["archivo"]).name for r in resultado} == {"modelo.xml", "modelo.bin"}
    assert all(len(r["sha256"]) == 64 for r in resultado)


def test_percentiles_de_una_muestra_y_sin_muestras():
    assert evaluacion.percentil([4], 0.95) == 4
    assert evaluacion.percentil([], 0.95) is None
