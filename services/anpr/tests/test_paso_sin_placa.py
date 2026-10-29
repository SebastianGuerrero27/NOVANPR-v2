"""
Vehículos sin placa visible (app/aplicacion/paso_sin_placa.py y su uso en el motor).

  - El vigilante abre un evento con el movimiento de la zona y lo entrega al cerrarse solo si fue
    fuerte (umbrales calibrados con el video real de la garita): el guardia caminando lejos no.
  - El motor registra el paso con su foto solo si el flujo de placas no lo registró y un detector de
    vehículos confirma uno con su punto de apoyo dentro de la zona; una persona no se registra.
"""
from __future__ import annotations

import dataclasses
import time
import types

import numpy as np
import pytest

from app.aplicacion.motor import ConfigMotor, DependenciasMotor, MotorAnpr
from app.aplicacion.paso_sin_placa import EventoMovimiento, ParametrosSinPlaca, VigilanteSinPlaca

CUADRO = np.zeros((1080, 1920, 3), np.uint8)


def serie(vigilante: VigilanteSinPlaca, fracciones: list[float], paso_s: float = 0.1, inicio: float = 100.0, placa: bool = False):
    eventos = []
    for i, f in enumerate(fracciones):
        e = vigilante.alimentar(inicio + i * paso_s, f, CUADRO, placa)
        if e:
            eventos.append(e)
    return eventos


# ─── Vigilante ───────────────────────────────────────────────────────────────

def test_un_auto_genera_un_evento_con_cuadros_repartidos_en_todo_el_paso():
    """Se guardan 8 cuadros repartidos en el evento, desde el primero (el vehículo entero acercándose):
    no los de mayor movimiento, que son los del vehículo pegado a la cámara, de costado."""
    v = VigilanteSinPlaca()
    # 4 s de auto (fracción hasta 0,8) y 3 s quietos: el evento cierra 1,5 s después del último movimiento
    eventos = serie(v, [0.0] * 5 + [0.05, 0.2, 0.5, 0.8, 0.7, 0.6, 0.4] + [0.3] * 30 + [0.0] * 30)
    assert len(eventos) == 1
    e = eventos[0]
    assert e.fraccion_max == pytest.approx(0.8)
    horas = [h for h, _, _ in e.cuadros]
    assert len(horas) == 8 and horas == sorted(horas)
    assert horas[0] == pytest.approx(100.6) and horas[-1] >= 103.5
    assert max(b - a for a, b in zip(horas, horas[1:])) < 1.0
    assert e.duracion_s == pytest.approx(3.6) and not e.placa_vista


def test_el_guardia_caminando_lejos_no_genera_evento_para_revisar():
    # Calibración: persona lejos 0,03–0,07 durante varios segundos
    assert serie(VigilanteSinPlaca(), [0.05, 0.07, 0.04, 0.06] * 20 + [0.0] * 30) == []


def test_un_destello_corto_es_ruido():
    assert serie(VigilanteSinPlaca(), [0.0, 0.9, 0.9, 0.0] + [0.0] * 30) == []


def test_movimiento_sostenido_se_corta_y_registra_si_hubo_placa():
    v = VigilanteSinPlaca(ParametrosSinPlaca(duracion_max_s=5.0))
    eventos = serie(v, [0.5] * 120 + [0.0] * 30, placa=True)
    assert len(eventos) >= 2 and all(e.duracion_s <= 5.0 for e in eventos)
    assert all(e.placa_vista for e in eventos)


# ─── Motor ───────────────────────────────────────────────────────────────────

class Respuesta:
    def __init__(self, status_code=201, datos=None):
        self.status_code, self._datos, self.text = status_code, datos or {}, str(datos)

    def json(self):
        return self._datos


class Http:
    def __init__(self):
        self.envios: list[tuple[str, dict]] = []

    def post(self, url, json=None, timeout=None):
        self.envios.append((url.rsplit("/api/", 1)[-1], json))
        return Respuesta(201, {"ingreso_id": 88}) if url.endswith("/ingreso") else Respuesta(200, {"deteccion": {}})


def motor_de_prueba(tmp_path, detecciones):
    guardadas: list[str] = []
    dep = DependenciasMotor(
        crear_fuente_video=lambda: None, crear_pipeline=lambda: None, crear_selector=lambda: None,
        crear_motor_ocr=lambda: None, crear_trabajador_ocr=lambda m, f: None, verificador=lambda: None,
        reconocedor_vehiculo=lambda: None, fuente_rtsp=lambda url: None, cuadro_espera=lambda n: CUADRO,
        mostrar_ventana=lambda n, f: False, cerrar_ventanas=lambda: None,
        guardar_imagen=lambda ruta, img: guardadas.append(ruta),
        metricas=types.SimpleNamespace(record_detection=lambda *a: None, record_detection_error=lambda *a: None),
        logger=types.SimpleNamespace(info=lambda *a: None, warning=lambda *a: None, error=lambda *a: None),
        detector_vehiculos=lambda: (lambda cuadro: detecciones),
    )
    config = ConfigMotor(backend_url="http://backend:5000", camara_id=3, fuente_camara="rtsp://x", rtsp_url="rtsp://x",
                         dir_media=str(tmp_path), hud_activo=False, ventana_local=False, peso_voto_verificador=1.0,
                         espera_sin_placa_s=0.0, espera_sin_placa_max_s=0.0)
    motor = MotorAnpr(config, dep, http=Http(), buffer_video=None)
    # Zona de interés: la vía de acceso (mitad inferior del cuadro)
    motor._pipeline = types.SimpleNamespace(roi=[[0.0, 0.4], [1.0, 0.4], [1.0, 1.0], [0.0, 1.0]], exclusiones=[], detector=None)
    return motor, guardadas


def evento(placa_vista=False):
    """Evento que acaba de cerrarse (las horas del motor son de reloj real)."""
    ahora = time.time()
    return EventoMovimiento(inicio=ahora - 4.0, fin=ahora - 1.5, fraccion_max=0.8, cuadros=[(ahora - 2.0, 0.8, CUADRO)],
                            placa_vista=placa_vista)


AUTO_EN_LA_VIA = ("automóvil", 0.91, [600.0, 500.0, 1500.0, 1070.0])


def test_un_auto_sin_placa_queda_registrado_con_su_foto_y_pendiente_de_revision(tmp_path):
    motor, guardadas = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    motor._evaluar_sin_placa(evento(), 3)
    rutas = [r for r, _ in motor._http.envios]
    assert rutas == ["detecciones/ingreso", "detecciones/completar-ocr"]
    ingreso, ocr = motor._http.envios[0][1], motor._http.envios[1][1]
    assert ingreso["placa"] is None and ingreso["confianza_deteccion"] == 0.91 and ingreso["camara_id"] == 3
    assert ingreso["tracking_id"] > 10_000_000 and ingreso["metadatos"]["vehiculo"] == {"tipo": "automóvil"}
    assert ocr["estado_procesamiento"] == "no_legible" and ocr["placa_reconocida"] is None and ocr["lectura_valida"] is False
    assert ocr["evidencia_lectura"]["motivo"] == "vehiculo_sin_placa"
    # Foto del cuadro (evidencia del paso) y recorte del vehículo
    assert [p.rsplit("\\", 1)[-1].rsplit("/", 1)[-1].split("_")[0] for p in guardadas] == ["ingreso", "vehiculo"]


def test_con_una_deteccion_con_forma_de_placa_el_motivo_es_placa_no_leida(tmp_path):
    motor, _ = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    motor._evaluar_sin_placa(evento(placa_vista=True), 3)
    assert motor._http.envios[1][1]["evidencia_lectura"]["motivo"] == "placa_no_leida"


@pytest.mark.parametrize("detecciones", [
    [],                                                       # una persona: el detector no ve vehículos
    [("automóvil", 0.91, [600.0, 50.0, 1500.0, 300.0])],      # tráfico de la calle: fuera de la zona
    [("automóvil", 0.30, [600.0, 500.0, 1500.0, 1070.0])],    # confianza insuficiente
    [("motocicleta", 0.90, [900.0, 900.0, 960.0, 1000.0])],   # demasiado pequeño (lejos)
])
def test_sin_vehiculo_confirmado_en_la_zona_no_se_registra(tmp_path, detecciones):
    motor, guardadas = motor_de_prueba(tmp_path, detecciones)
    motor._evaluar_sin_placa(evento(), 3)
    assert motor._http.envios == [] and guardadas == []


def test_si_el_flujo_de_placas_ya_registro_el_paso_no_se_duplica(tmp_path):
    motor, guardadas = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    e = evento()
    motor._ultimo_ingreso = e.inicio + 1.0   # registrado durante el evento
    motor._evaluar_sin_placa(e, 3)
    assert motor._http.envios == [] and guardadas == []


def test_una_zona_de_exclusion_sobre_el_vehiculo_lo_descarta(tmp_path):
    motor, _ = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    motor._pipeline.exclusiones = [[[0.2, 0.8], [0.9, 0.8], [0.9, 1.0], [0.2, 1.0]]]
    motor._evaluar_sin_placa(evento(), 3)
    assert motor._http.envios == []


def test_la_evidencia_es_el_vehiculo_entero_y_no_el_mas_grande_cortado_por_el_borde(tmp_path):
    """Un auto rápido que pasa pegado a la cámara se ve enorme pero cortado (de costado, sin placa a
    la vista); la evidencia es el cuadro en que se ve entero, aunque sea más pequeño."""
    entero = np.full((1080, 1920, 3), 10, np.uint8)
    cortado = np.full((1080, 1920, 3), 20, np.uint8)
    por_cuadro = {10: [("automóvil", 0.9, [600.0, 500.0, 1300.0, 1000.0])],      # entero, acercándose
                  20: [("automóvil", 0.9, [700.0, 0.0, 1920.0, 1080.0])]}       # pegado a la cámara
    motor, _ = motor_de_prueba(tmp_path, [])
    motor._dep = dataclasses.replace(motor._dep, detector_vehiculos=lambda: (lambda c: por_cuadro[int(c[0, 0, 0])]))
    ahora = time.time()
    e = EventoMovimiento(inicio=ahora - 4.0, fin=ahora - 1.5, fraccion_max=0.9,
                         cuadros=[(ahora - 3.0, 0.5, entero), (ahora - 2.0, 0.9, cortado)])
    _, _, _, caja, cuadro = motor._vehiculo_en_zona(motor._dep.detector_vehiculos(), e)
    assert cuadro is entero and caja == [600.0, 500.0, 1300.0, 1000.0]


def test_el_vigilante_mide_el_movimiento_a_ritmo_propio_sin_depender_del_detector(tmp_path):
    """El hilo de captura alimenta al vigilante 6 veces por segundo con su propio detector de
    movimiento: una moto que cruza en 2 s abre y cierra su evento y se manda a revisar aunque el
    detector de placas no haya analizado ninguno de esos cuadros (con la CPU ocupada analizaba 1 por
    segundo y la moto no llegaba a abrir un evento)."""
    motor, _ = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    fracciones = iter([0.0] * 3 + [0.10, 0.25, 0.30, 0.25, 0.10] + [0.0] * 20)
    motor._movimiento_vigilante = types.SimpleNamespace(analizar=lambda f, roi, excl: types.SimpleNamespace(fraccion=next(fracciones)))
    revisados = []
    motor._ejecutor_reevaluacion = types.SimpleNamespace(submit=lambda f, evento, camara: revisados.append(evento))
    motor._placa_vista_hora = 100.4
    for i in range(28):
        motor._vigilar_movimiento(CUADRO, 100.0 + i / 6)
    assert len(revisados) == 1
    e = revisados[0]
    assert e.fraccion_max == pytest.approx(0.30) and e.placa_vista and len(e.cuadros) == 3


def _con_paso_registrado(motor, ultima: float, caja_placa):
    """El flujo de placas registró TZK-7162 (pista 9575) y su placa se vio por última vez a `ultima`."""
    from app.aplicacion.consolidacion import Vista
    motor._pistas_registradas[9575] = (ultima - 1.0, "TZK7162")
    motor._vistas[9575] = Vista(ultima - 3.0, caja_placa, ultima, caja_placa)


def test_el_auto_ya_registrado_que_sigue_su_camino_no_se_registra_otra_vez(tmp_path):
    """22-10-2026: TZK-7162 se registró con su placa; se detuvo junto al guardia y al seguir, su
    movimiento abrió otro evento que se registró como «placa no leída» (dato duplicado)."""
    motor, guardadas = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    e = evento()
    _con_paso_registrado(motor, ultima=e.inicio + 0.5, caja_placa=[1000.0, 900.0, 1100.0, 940.0])
    motor._evaluar_sin_placa(e, 3)
    assert motor._http.envios == [] and guardadas == []


def test_si_la_placa_ya_no_se_ve_lo_identifica_su_ultima_posicion_dentro_del_vehiculo(tmp_path):
    motor, guardadas = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    e = evento()
    _con_paso_registrado(motor, ultima=e.inicio - 8.0, caja_placa=[1000.0, 900.0, 1100.0, 940.0])
    motor._evaluar_sin_placa(e, 3)
    assert motor._http.envios == [] and guardadas == []


def test_otro_vehiculo_que_entra_despues_si_se_registra(tmp_path):
    """La placa del paso registrado quedó lejos del vehículo nuevo: es otro y se registra."""
    motor, _ = motor_de_prueba(tmp_path, [AUTO_EN_LA_VIA])
    e = evento()
    _con_paso_registrado(motor, ultima=e.inicio - 8.0, caja_placa=[100.0, 300.0, 200.0, 340.0])
    motor._evaluar_sin_placa(e, 3)
    assert [r for r, _ in motor._http.envios] == ["detecciones/ingreso", "detecciones/completar-ocr"]

