"""Seguidor de la caja del HUD entre dos análisis del detector (flujo óptico en cada cuadro)."""
import numpy as np
import pytest

from app.aplicacion.detector import DetectionPipeline, KalmanBoxTracker
from app.aplicacion.seguidor_flujo import MAX_CUADROS_A_CIEGAS, SeguidorFlujo, flujo_placa
from app.infraestructura.detectors import MockDetector

ANCHO, ALTO, FPS = 640, 360, 30.0
# "Placa": bloques claros y oscuros como caracteres, con esquinas que el flujo puede seguir
_rng = np.random.default_rng(7)
PLACA = (np.kron(_rng.random((6, 18)) > 0.5, np.ones((5, 5))) * 200 + 30).astype(np.uint8)
ALTO_P, ANCHO_P = PLACA.shape


def cuadro(x: int, y: int) -> np.ndarray:
    f = np.full((ALTO, ANCHO), 90, np.uint8)
    f[y:y + ALTO_P, x:x + ANCHO_P] = PLACA
    return f


def caja(x: int, y: int) -> tuple[float, float, float, float]:
    return (float(x), float(y), float(x + ANCHO_P), float(y + ALTO_P))


def test_el_flujo_mide_el_desplazamiento_de_la_placa():
    dx, dy, escala = flujo_placa(cuadro(100, 100), cuadro(106, 103), caja(100, 100))
    assert dx == pytest.approx(6, abs=0.5)
    assert dy == pytest.approx(3, abs=0.5)
    assert escala == pytest.approx(1.0, abs=0.03)


def test_la_caja_sigue_a_la_placa_en_cada_cuadro_entre_dos_analisis():
    seguidor = SeguidorFlujo()
    seguidor.avanzar(cuadro(100, 120), 0, 0.0)
    seguidor.anclar({1: (caja(100, 120), None)}, 0, 0.0)
    for i in range(1, 11):
        seguidor.avanzar(cuadro(100 + 5 * i, 120), i, i / FPS)
    p = seguidor.pistas()[1]
    assert p.indice == 10
    assert p.caja[0] == pytest.approx(150, abs=1.5)
    assert p.caja[1] == pytest.approx(120, abs=1.5)
    # 5 px por cuadro a 30 cuadros por segundo
    assert p.velocidad[0] == pytest.approx(150, rel=0.1)


def test_un_analisis_atrasado_se_lleva_hasta_el_cuadro_actual():
    seguidor = SeguidorFlujo()
    for i in range(9):
        seguidor.avanzar(cuadro(100 + 4 * i, 120), i, i / FPS)
    # El detector terminó de analizar el cuadro 2 cuando ya había llegado el 8
    seguidor.anclar({7: (caja(108, 120), [(108.0, 120.0), (198.0, 120.0), (198.0, 150.0), (108.0, 150.0)])}, 2, 2 / FPS)
    p = seguidor.pistas()[7]
    assert p.indice == 8
    assert p.caja[0] == pytest.approx(132, abs=1.5)
    assert p.puntos[0][0] == pytest.approx(132, abs=1.5)


def test_un_analisis_mas_viejo_que_lo_guardado_no_deja_la_caja_atrasada():
    """Con la CPU ocupada un análisis puede llegar cuando su cuadro ya no está guardado: su caja es
    de hace demasiado. La pista que ya se seguía conserva la del flujo; una nueva no se dibuja."""
    seguidor = SeguidorFlujo(cuadros_guardados=4)
    seguidor.avanzar(cuadro(100, 120), 0, 0.0)
    seguidor.anclar({1: (caja(100, 120), None)}, 0, 0.0)
    for i in range(1, 9):
        seguidor.avanzar(cuadro(100 + 4 * i, 120), i, i / FPS)
    seguidor.anclar({1: (caja(104, 120), None), 2: (caja(300, 200), None)}, 1, 1 / FPS)
    pistas = seguidor.pistas()
    assert set(pistas) == {1}
    assert pistas[1].caja[0] == pytest.approx(132, abs=1.5)
    assert seguidor.estadisticas()["analisis_fuera_de_lo_guardado"] == 1


def test_la_prediccion_del_kalman_no_reemplaza_a_la_caja_del_flujo():
    """Si el detector no vio la placa en un análisis, la caja de la pista es la predicción del
    Kalman: el flujo, que mide el movimiento real, conserva la suya."""
    seguidor = SeguidorFlujo()
    seguidor.avanzar(cuadro(100, 120), 0, 0.0)
    seguidor.anclar({1: (caja(100, 120), None, False)}, 0, 0.0)
    for i in range(1, 6):
        seguidor.avanzar(cuadro(100 + 5 * i, 120), i, i / FPS)
    seguidor.anclar({1: (caja(60, 100), None, True)}, 5, 5 / FPS)
    assert seguidor.pistas()[1].caja[0] == pytest.approx(125, abs=1.5)


def test_la_caja_que_sale_del_cuadro_deja_de_seguirse():
    seguidor = SeguidorFlujo()
    x = ANCHO - ANCHO_P - 2
    seguidor.avanzar(cuadro(x, 120), 0, 0.0)
    seguidor.anclar({1: (caja(x, 120), None)}, 0, 0.0)
    seguidor._pistas[1] = seguidor._pistas[1].__class__((float(ANCHO - 2), 120.0, float(ANCHO + 88), 150.0), None,
                                                        (3000.0, 0.0), 0, 0.0)
    liso = np.full((ALTO, ANCHO), 90, np.uint8)
    seguidor.avanzar(liso, 1, 1 / FPS)
    assert seguidor.pistas() == {}


def test_sin_textura_avanza_con_su_velocidad_y_luego_se_detiene():
    seguidor = SeguidorFlujo()
    seguidor.avanzar(cuadro(100, 120), 0, 0.0)
    seguidor.anclar({1: (caja(100, 120), None)}, 0, 0.0)
    for i in range(1, 6):
        seguidor.avanzar(cuadro(100 + 5 * i, 120), i, i / FPS)
    liso = np.full((ALTO, ANCHO), 90, np.uint8)
    for i in range(6, 6 + MAX_CUADROS_A_CIEGAS + 3):
        seguidor.avanzar(liso, i, i / FPS)
    p = seguidor.pistas()[1]
    assert p.velocidad == (0.0, 0.0)
    # Avanzó a ciegas unos cuadros más allá de donde se perdió la textura (x = 125) y se detuvo
    assert 125 + 2 * MAX_CUADROS_A_CIEGAS <= p.caja[0] <= 125 + 7 * MAX_CUADROS_A_CIEGAS


def test_las_placas_que_no_vienen_en_un_analisis_dejan_de_seguirse():
    seguidor = SeguidorFlujo()
    seguidor.avanzar(cuadro(100, 120), 0, 0.0)
    seguidor.anclar({1: (caja(100, 120), None), 2: (caja(300, 200), None)}, 0, 0.0)
    seguidor.anclar({2: (caja(300, 200), None)}, 0, 0.0)
    assert set(seguidor.pistas()) == {2}
    seguidor.reiniciar()
    assert seguidor.pistas() == {}


def test_la_velocidad_del_kalman_esta_en_pixeles_por_segundo_reales():
    """El filtro avanza un paso por cuadro analizado: a 3 análisis por segundo, 10 px por paso son
    30 px/s (antes se multiplicaba por 30 fps nominales y daba 300)."""
    pipeline = DetectionPipeline(detector=MockDetector())
    trk = KalmanBoxTracker([100, 100, 190, 130])
    trk.kf.statePost[4, 0], trk.kf.statePost[5, 0] = 10.0, -4.0
    pipeline._paso_kalman_s = 1 / 3
    vx, vy = pipeline.velocidad_px_s(trk)
    assert vx == pytest.approx(30.0)
    assert vy == pytest.approx(-12.0)
