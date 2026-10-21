"""
Un vehículo, un paso (app/aplicacion/consolidacion.py), con los casos del video de la garita.
Lo importante es no unir dos vehículos distintos: perder un paso es peor que duplicarlo.
"""
from __future__ import annotations

import numpy as np

from app.aplicacion.consolidacion import PasoReciente, Vista, casi_iguales, lectura_legible, lee_mejor, mismo_paso, paso_mas_cercano
from app.aplicacion.paso_sin_placa import VigilanteSinPlaca

ANCHO = 1920.0


def paso(tid=430, placa="SAW148", hora=100.0, camara=2, valida=False, ancho=60.0, conf=0.9):
    return PasoReciente(tid, 44, camara, placa, valida, ancho, conf, hora)


def test_placas_que_difieren_en_uno_o_dos_caracteres_son_el_mismo_paso():
    assert casi_iguales("PER6147", "PFR6147") and casi_iguales("PYL512", "PXL512")
    assert casi_iguales("PFR614", "PFR6147")                 # la foto lejana no alcanzó a leer un dígito
    # TEN-394 y TBN-3950 (video, 20-10-2026) difieren en 3: esas pistas las une la continuidad, no el texto
    assert not casi_iguales("TEN394", "TBN3950")
    assert not casi_iguales("PBA1234", "PBA1234")            # la misma placa la cubre el anti-duplicado exacto
    assert not casi_iguales("TBN6274", "TBN3950")             # dos autos distintos del video
    assert not casi_iguales("TBC2288", "TBN3950")
    assert not casi_iguales("PB123", "PB124")                 # lecturas demasiado cortas para compararlas


def test_la_pista_que_continua_a_la_registrada_es_el_mismo_paso():
    # Track #430 registrado; #431 aparece 0,4 s después, 150 px más abajo (el auto se acerca)
    vistas = {430: Vista(95.0, [800, 300, 860, 320], 100.0, [820, 320, 890, 345]),
              431: Vista(100.4, [830, 420, 910, 450], 101.0, [840, 450, 930, 485])}
    assert mismo_paso(431, "FVU583", 2, 101.0, vistas, [paso()], ANCHO) is not None


def test_dos_vehiculos_seguidos_no_se_unen():
    # El siguiente aparece 1 s después pero arriba (lejos), donde no se perdió la placa anterior
    vistas = {430: Vista(95.0, [800, 300, 860, 320], 100.0, [700, 900, 900, 960]),
              500: Vista(101.0, [900, 250, 950, 265], 102.0, [900, 260, 955, 280])}
    assert mismo_paso(500, "TBN3950", 2, 102.0, vistas, [paso()], ANCHO) is None
    # Cerca, pero 6 s después de perderse la anterior
    vistas[501] = Vista(106.0, [710, 890, 890, 950], 107.0, [710, 890, 890, 950])
    assert mismo_paso(501, "TBC2288", 2, 107.0, vistas, [paso()], ANCHO) is None
    # Otra cámara
    assert mismo_paso(431, "SAW149", 1, 101.0, {}, [paso()], ANCHO) is None


def test_la_pista_anterior_que_se_registra_despues_tambien_es_el_mismo_paso():
    # Paso 1 del video (20-10-2026): el track #480 se registró primero aunque el #479 apareció antes
    registrado = paso(tid=480, placa="SVU581", hora=101.0)
    vistas = {479: Vista(98.0, [700, 250, 745, 272], 99.6, [720, 290, 770, 315]),
              480: Vista(99.9, [725, 300, 799, 343], 101.0, [740, 330, 820, 380])}
    assert mismo_paso(479, "FZU584", 2, 101.5, vistas, [registrado], ANCHO) is registrado
    hueco_y_distancia = paso_mas_cercano(479, 2, 101.5, vistas, [registrado])
    assert hueco_y_distancia is not None and round(hueco_y_distancia[1], 1) == 0.3
    assert round(hueco_y_distancia[3], 2) == 1.48                            # 74 px / 50 px


def test_dos_vehiculos_a_la_vez_no_se_unen():
    # Dos placas visibles al mismo tiempo durante 3 s: son dos vehículos, aunque estén cerca
    vistas = {430: Vista(95.0, [800, 300, 860, 320], 100.0, [800, 300, 860, 320]),
              431: Vista(97.0, [900, 300, 960, 320], 100.0, [900, 300, 960, 320])}
    assert mismo_paso(431, "TBC2288", 2, 100.0, vistas, [paso()], ANCHO) is None


def test_la_placa_cercana_que_reaparece_lejos_es_el_mismo_paso_y_el_vehiculo_siguiente_no():
    # Paso 8 de la quinta pasada: TBN-3950, cerca de la cámara, reapareció a 714 px con una placa parecida
    vistas = {2429: Vista(95.0, [600, 300, 660, 330], 100.0, [500, 600, 600, 650]),
              2434: Vista(100.0, [1180, 700, 1290, 755], 100.5, [1200, 720, 1310, 775])}
    assert mismo_paso(2434, "TBN3950", 2, 100.5, vistas, [paso(2429, "TBN3950")], ANCHO) is not None
    # El vehículo siguiente aparece a una distancia parecida, pero lejos de la cámara: su placa es la
    # cuarta parte de la anterior al perderse
    vistas[2500] = Vista(101.0, [1000, 120, 1025, 132], 102.0, [1000, 130, 1028, 144])
    assert mismo_paso(2500, "TBC2288", 2, 102.0, vistas, [paso(2429, "TBN3950")], ANCHO) is None


def test_la_placa_casi_igual_vale_solo_dentro_de_la_ventana():
    assert mismo_paso(846, "PFR6147", 2, 105.0, {}, [paso(843, "PER6147", 100.0)], ANCHO) is not None
    assert mismo_paso(846, "PFR6147", 2, 125.0, {}, [paso(843, "PER6147", 100.0)], ANCHO) is None


def test_lee_mejor_prefiere_la_placa_mas_cercana_si_es_legible():
    # Video, 20-10-2026: la pista lejana (38 px) leyó FSR-0147 «válida»; la cercana (70 px) PFR-6147
    # con una sola lectura. Gana la cercana: la marca «válida» depende de cuántas lecturas juntó
    lejana = paso(placa="FSR0147", valida=True, ancho=38.0, conf=0.9)
    assert lee_mejor(False, 70.0, 0.8, True, lejana)
    # El adoquinado (92 px, 2 caracteres) leyó SVT-584: no es legible y no corrige a SVU-584
    assert not lee_mejor(True, 92.0, 1.0, False, paso(placa="SVU584", valida=True, ancho=76.0))
    # La lectura más lejana no corrige a la cercana, aunque sea válida
    assert not lee_mejor(True, 38.0, 1.0, True, paso(valida=False, ancho=70.0, conf=0.8))
    # Con un tamaño parecido: la válida y luego la de más confianza
    parecida = paso(valida=False, ancho=60.0, conf=1.0)
    assert lee_mejor(True, 55.0, 0.8, True, parecida)
    assert not lee_mejor(False, 65.0, 0.9, True, parecida)


def test_lectura_legible_exige_fila_de_caracteres_y_ningun_caracter_inferido():
    assert lectura_legible(7, 0) and lectura_legible(5, 0)
    assert not lectura_legible(2, 0)     # adoquinado del piso
    assert not lectura_legible(7, 1)     # QHD-0060 sobre el marco «ambacar»: un carácter inferido


def test_un_paso_en_registro_tambien_recibe_las_pistas_que_lo_continuan():
    # Paso 1 del video: el track #873 llegó cuando el #872 aún esperaba la respuesta del backend
    en_curso = PasoReciente(872, 0, 2, "HAW146", False, 33.0, 1.0, 100.0)
    vistas = {872: Vista(98.0, [800, 300, 833, 319], 100.0, [805, 310, 838, 329]),
              873: Vista(100.6, [810, 330, 858, 355], 101.0, [812, 335, 860, 360])}
    assert mismo_paso(873, "FMQ395", 2, 101.0, vistas, [en_curso], ANCHO) is en_curso


# ─── Vigilante a pocos cuadros por segundo ───────────────────────────────────

def test_a_tres_cuadros_por_segundo_la_moto_genera_un_evento_y_el_destello_no():
    descartados = []
    v = VigilanteSinPlaca(al_descartar=descartados.append)
    cuadro = np.zeros((4, 4, 3), np.uint8)
    eventos = []
    # Moto: 3 muestras a 0,33 s (0,10 → 0,25 → 0,20) y luego quieto
    for i, f in enumerate([0.0, 0.10, 0.25, 0.20] + [0.0] * 8):
        e = v.alimentar(100.0 + i / 3, f, cuadro)
        if e:
            eventos.append(e)
    assert len(eventos) == 1 and eventos[0].muestras == 3
    # Un solo cuadro con movimiento fuerte: se descarta, y se informa para el diagnóstico
    for i, f in enumerate([0.9] + [0.0] * 8):
        assert v.alimentar(200.0 + i / 3, f, cuadro) is None
    assert len(descartados) == 1 and descartados[0].muestras == 1 and descartados[0].fraccion_max == 0.9
