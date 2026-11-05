"""El gestor reconcilia las cámaras del motor con la lista que envía el backend y aísla una de otra."""

from __future__ import annotations

import threading
import time
import types

import numpy as np

from app.aplicacion.gestor_camaras import GestorCamaras
from app.infraestructura.detectors import MockDetector, PoolDetector

LOG = types.SimpleNamespace(info=lambda *a: None, error=lambda *a: None, warning=lambda *a: None)
ROI = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]


class MotorFalso:
    def __init__(self, camara_id, nombre, url):
        self.camara_id, self.nombre, self.fuente_camara = camara_id, nombre, url
        self.activo = False
        self.pipeline = None
        self.iniciado = threading.Event()
        self.detenido = threading.Event()
        self.espero_registros = None
        self.zonas = []
        self.cambios = []
        self.roi, self.exclusiones = None, []

    def iniciar(self):
        self.activo = True
        self.pipeline = object()
        self.iniciado.set()

    def detener(self, esperar=False):
        self.activo = False
        self.espero_registros = esperar
        self.detenido.set()

    def fijar_roi(self, payload):
        self.roi, self.exclusiones = payload["roi"], payload["exclusiones"]
        self.zonas.append(payload)
        return 200, {}

    def cambiar_camara(self, payload):
        self.cambios.append(payload)
        self.fuente_camara = payload["rtsp_url"]
        return 200, {}

    def camara_activa(self):
        return {"camera_id": self.camara_id, "camera_source": self.fuente_camara, "is_connected": self.activo,
                "roi": self.roi, "exclusiones": self.exclusiones}

    def estado(self):
        return {"capture_fps": 25.0 if self.activo else 0.0, "tracker_fps": 10.0 if self.activo else 0.0,
                "inferencias_omitidas_pct": 0.0, "enlace_video": None, "latencia": {}, "etapas_ms": {}, "seguidor": {}}


def gestor_de_prueba(max_camaras=3, crear=None):
    creados = {}

    def fabrica(camara_id, nombre, url):
        motor = (crear or MotorFalso)(camara_id, nombre, url)
        creados[camara_id] = motor
        return motor

    return GestorCamaras(fabrica, max_camaras, lambda: None, lambda: {"detector": "yolo26"}, LOG), creados


def camara(i, **extra):
    return {"id": i, "nombre": f"Cámara {i}", "rtsp_url": f"rtsp://anpr:clave@mediamtx:8554/cam_{i}", **extra}


def esperar(condicion, tope=2.0):
    limite = time.time() + tope
    while time.time() < limite:
        if condicion():
            return True
        time.sleep(0.005)
    return condicion()


def test_arranca_cada_camara_con_sus_zonas():
    gestor, creados = gestor_de_prueba()
    assert gestor.reconciliar({"camaras": [camara(1, roi=ROI), camara(2, exclusiones=[ROI])]}) == (
        200, {"success": True, "camaras": [1, 2], "max_camaras": 3})
    assert creados[1].iniciado.wait(2) and creados[2].iniciado.wait(2)
    assert esperar(lambda: creados[1].zonas and creados[2].zonas)
    assert creados[1].roi == ROI and creados[1].exclusiones == []
    assert creados[2].roi is None and creados[2].exclusiones == [ROI]
    assert gestor.motor(1) is creados[1] and gestor.motor("2") is creados[2]
    assert gestor.motor(9) is None and gestor.motor(None) is None and gestor.motor("x") is None


def test_repetir_la_misma_lista_no_reinicia_nada():
    gestor, creados = gestor_de_prueba()
    gestor.reconciliar({"camaras": [camara(1, roi=ROI)]})
    motor = creados[1]
    assert motor.iniciado.wait(2) and esperar(lambda: motor.zonas)
    gestor.reconciliar({"camaras": [camara(1, roi=ROI)]})
    assert creados[1] is motor and len(motor.zonas) == 1 and motor.cambios == [] and not motor.detenido.is_set()


def test_la_camara_que_sale_de_la_lista_se_detiene_esperando_sus_registros():
    gestor, creados = gestor_de_prueba()
    gestor.reconciliar({"camaras": [camara(1), camara(2)]})
    assert creados[1].iniciado.wait(2)
    assert gestor.reconciliar({"camaras": [camara(2)]})[1]["camaras"] == [2]
    assert creados[1].detenido.wait(2) and creados[1].espero_registros is True
    assert gestor.motor(1) is None and not creados[2].detenido.is_set()


def test_corrige_zonas_y_fuente_de_una_camara_en_analisis():
    gestor, creados = gestor_de_prueba()
    gestor.reconciliar({"camaras": [camara(1)]})
    motor = creados[1]
    assert motor.iniciado.wait(2) and esperar(lambda: motor.zonas)
    gestor.reconciliar({"camaras": [camara(1, roi=ROI)]})
    assert motor.roi == ROI and motor.cambios == []
    gestor.reconciliar({"camaras": [{**camara(1, roi=ROI), "rtsp_url": "rtsp://anpr:otra@mediamtx:8554/cam_1"}]})
    assert motor.fuente_camara == "rtsp://anpr:otra@mediamtx:8554/cam_1" and motor.cambios[0]["roi"] == ROI


def test_rechaza_entera_una_lista_mayor_que_su_capacidad():
    """Mejor rechazar que saturar la CPU y perder placas en todas las cámaras."""
    gestor, creados = gestor_de_prueba(max_camaras=2)
    gestor.reconciliar({"camaras": [camara(1)]})
    assert gestor.reconciliar({"camaras": [camara(1), camara(2), camara(3)]}) == (
        409, {"error": "Este motor admite hasta 2 cámaras", "max_camaras": 2})
    assert list(creados) == [1] and gestor.motor(1) is creados[1]


def test_lista_invalida_no_cambia_nada():
    gestor, creados = gestor_de_prueba()
    gestor.reconciliar({"camaras": [camara(1)]})
    assert gestor.reconciliar({})[0] == 400
    assert gestor.reconciliar([])[0] == 400
    assert gestor.reconciliar({"camaras": [{"rtsp_url": "rtsp://x"}]})[0] == 400
    assert gestor.reconciliar({"camaras": [{"id": 2, "rtsp_url": "http://x"}]})[0] == 400
    assert gestor.motor(1) is creados[1] and not creados[1].detenido.is_set()


def test_los_modelos_se_cargan_con_la_primera_camara():
    """Un motor de reserva, sin cámaras, no gasta la memoria de los modelos."""
    cargas = []
    gestor = GestorCamaras(MotorFalso, 2, lambda: cargas.append(1), lambda: {}, LOG)
    gestor.iniciar()
    assert cargas == []
    gestor.reconciliar({"camaras": [camara(1)]})
    assert esperar(lambda: gestor.motor(1).activo) and cargas == [1]


def test_una_camara_que_no_arranca_no_afecta_a_las_demas_y_se_reintenta():
    class MotorQueFalla(MotorFalso):
        intentos = 0

        def iniciar(self):
            if self.camara_id == 1 and MotorQueFalla.intentos == 0:
                MotorQueFalla.intentos += 1
                raise RuntimeError("sin modelo")
            super().iniciar()

    gestor, creados = gestor_de_prueba(crear=MotorQueFalla)
    gestor.reconciliar({"camaras": [camara(1), camara(2)]})
    assert creados[2].iniciado.wait(2)
    assert esperar(lambda: gestor.motor(1) is None)
    gestor.reconciliar({"camaras": [camara(1), camara(2)]})
    assert creados[1].iniciado.wait(2) and gestor.motor(1) is creados[1]


def test_estado_por_camara_y_promedio_de_las_que_reciben_video():
    gestor, creados = gestor_de_prueba()
    gestor.reconciliar({"camaras": [camara(2), camara(1)]})
    assert creados[1].iniciado.wait(2) and creados[2].iniciado.wait(2)
    e = gestor.estado()
    assert [c["id"] for c in e["camaras"]] == [1, 2] and e["max_camaras"] == 3 and e["detector"] == "yolo26"
    assert e["capture_fps"] == 25.0 and e["tracker_fps"] == 10.0
    creados[1].activo = False  # sin señal: no baja el promedio de las que sí tienen video
    e = gestor.estado()
    assert e["camaras"][0]["conectada"] is False and e["capture_fps"] == 25.0


def test_detener_el_servicio_detiene_todas_las_camaras():
    gestor, creados = gestor_de_prueba()
    gestor.iniciar()
    gestor.reconciliar({"camaras": [camara(1), camara(2)]})
    assert creados[1].iniciado.wait(2) and creados[2].iniciado.wait(2)
    gestor.detener()
    assert creados[1].detenido.is_set() and creados[2].detenido.is_set() and gestor.motor(1) is None and not gestor.activo


# ─── Detector compartido ─────────────────────────────────────────────────────

def test_el_pool_crea_las_copias_una_vez_y_las_cuenta():
    creados = []

    def crear():
        creados.append(MockDetector())
        return creados[-1]

    pool = PoolDetector(crear, 2)
    assert len(creados) == 2
    assert pool.predict(np.zeros((4, 4, 3), np.uint8)) == []


def test_el_pool_turna_a_las_camaras_sin_inferencias_simultaneas_por_copia():
    """Con una copia nunca hay dos inferencias a la vez y ninguna cámara queda sin turno."""
    en_curso, maximo = [0], [0]
    candado = threading.Lock()

    class Lento(MockDetector):
        def predict(self, frame):
            with candado:
                en_curso[0] += 1
                maximo[0] = max(maximo[0], en_curso[0])
            time.sleep(0.002)
            with candado:
                en_curso[0] -= 1
            return []

    pool = PoolDetector(Lento, 1)
    turnos = {i: 0 for i in range(4)}

    def camara_analizando(i):
        for _ in range(25):
            pool.predict(np.zeros((4, 4, 3), np.uint8))
            turnos[i] += 1

    hilos = [threading.Thread(target=camara_analizando, args=(i,)) for i in turnos]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(10)
    assert maximo[0] == 1 and all(n == 25 for n in turnos.values())
