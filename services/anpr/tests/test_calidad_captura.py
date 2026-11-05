"""El diagnóstico de la captura mide las placas registradas y traduce lo medido en ajustes de la cámara."""

from __future__ import annotations

import cv2
import numpy as np

from app.aplicacion.calidad_captura import MINIMO_PARA_OPINAR, CalidadCaptura, medir_placa, recomendaciones


def placa(ancho=180, alto=60, brillo=200, desenfoque=0):
    img = np.full((alto, ancho, 3), brillo, np.uint8)
    paso = max(6, ancho // 8)
    for x in range(paso // 2, ancho - paso // 2, paso):
        cv2.rectangle(img, (x, alto // 4), (x + paso // 3, 3 * alto // 4), (20, 20, 20), -1)
    if desenfoque:
        k = np.full((1, desenfoque), 1.0 / desenfoque, np.float32)
        img = cv2.filter2D(img, -1, k)
    return img


def test_la_nitidez_no_depende_del_tamano_y_baja_con_el_movimiento():
    nitida, chica = medir_placa(placa(240, 80)), medir_placa(placa(120, 40))
    movida = medir_placa(placa(240, 80, desenfoque=9))
    assert nitida.ancho_px == 240 and chica.ancho_px == 120
    assert 0.4 < chica.nitidez / nitida.nitidez < 2.5
    assert movida.nitidez < 0.5 * nitida.nitidez


def test_brillo_y_saturacion():
    assert medir_placa(placa(brillo=40)).brillo < medir_placa(placa(brillo=200)).brillo
    assert medir_placa(placa(brillo=255)).saturada > 0.5
    assert medir_placa(np.zeros((2, 2, 3), np.uint8)) is None


def test_recomienda_lo_que_falla_y_nada_si_todo_esta_bien():
    assert recomendaciones(180, 1300, 150, 0.0) == []
    codigos = [r["codigo"] for r in recomendaciones(65, 300, 150, 0.3)]
    assert codigos == ["placa_pequena", "placa_movida", "placa_saturada"]
    # De noche la nitidez baja por la poca luz: se pide luz, no otra obturación
    assert [r["codigo"] for r in recomendaciones(180, 120, 27, 0.0)] == ["placa_oscura"]
    assert "65 px" in recomendaciones(65, 1300, 150, 0)[0]["texto"]


def test_no_opina_con_pocas_placas_y_resume_las_ultimas():
    c = CalidadCaptura(muestras=10)
    for _ in range(MINIMO_PARA_OPINAR - 1):
        c.registrar(placa(70, 24))
    assert c.resumen()["recomendaciones"] == [] and c.resumen()["ancho_px_p50"] is None
    c.registrar(placa(70, 24))
    r = c.resumen()
    assert r["placas"] == MINIMO_PARA_OPINAR and r["ancho_px_p50"] == 70
    assert any(x["codigo"] == "placa_pequena" for x in r["recomendaciones"])
    for _ in range(10):
        c.registrar(placa(200, 66))
    assert c.resumen()["ancho_px_p50"] == 200 and c.resumen()["placas"] == 10
