"""
ECU 911 ANPR Microservice — raíz de composición.

Conecta el motor de reconocimiento de cada cámara (app/aplicacion/motor.py) con sus adaptadores reales
(modelos YOLO y OCR, verificador PP-OCRv6, atributos del vehículo, fuentes de video, cliente HTTP hacia
el backend, disco, métricas y registro), reúne las cámaras en un gestor (app/aplicacion/gestor_camaras.py)
y crea el servidor FastAPI (app/interfaz/api.py).

    uvicorn app.main:app

Arquitectura en dos fases: captura fotográfica rápida + OCR asíncrono de alta fidelidad.
Los modelos se cargan una sola vez y los comparten todas las cámaras.
"""

from __future__ import annotations

import os
import sys
import threading
from typing import Any, Callable

import cv2
import httpx

from app.aplicacion.detector import crear_detector_placas, pipeline_de_camara
from app.aplicacion.frame_selector import BestFrameSelector
from app.aplicacion.gestor_camaras import GestorCamaras
from app.aplicacion.motor import ConfigMotor, DependenciasMotor, MotorAnpr
from app.aplicacion.ocr_worker import AsyncOcrWorker
from app.aplicacion.paso_sin_placa import ParametrosSinPlaca
from app.infraestructura import metrics
from app.infraestructura.config import (
    ANPR_DETECTORES,
    ANPR_HILOS_OPENCV,
    ANPR_INTERVALO_GIL_MS,
    ANPR_MAX_CAMARAS,
    BACKEND_HEADERS,
    BACKEND_URL,
    DEBUG_SHOW_WINDOW,
    DEBUG_VISUAL,
    MEDIA_DIR,
    OCR_VERIFIER_MAX_MS,
    REGISTRO_MAX_MS,
    OCR_VERIFIER_VOTE_WEIGHT,
    PLATE_REGISTRATION_MIN_CONFIDENCE,
    RUNNING_IN_DOCKER,
    SIN_PLACA_ESPERA_S,
    SIN_PLACA_FRACCION_VEHICULO,
    SIN_PLACA_HABILITADO,
    RESCATE_CUADROS,
)
from app.infraestructura.debug_stream import DebugFrameBuffer, cuadro_espera, try_imshow
from app.infraestructura.detectors import PoolDetector
from app.infraestructura.logger import get_logger
from app.infraestructura.ocr_engine import create_ocr_engine
from app.infraestructura.ocr_verifier import get_verifier
from app.infraestructura.vehicle_attributes import get_vehicle_recognizer
from app.infraestructura.vehiculos_coco import get_detector_vehiculos
from app.infraestructura.video_source import RTSPSource
from app.interfaz.api import crear_app


sys.setswitchinterval(ANPR_INTERVALO_GIL_MS / 1000.0)
if ANPR_HILOS_OPENCV > 0:
    cv2.setNumThreads(ANPR_HILOS_OPENCV)


def una_vez(fabrica: Callable[[], Any]) -> Callable[[], Any]:
    """Crea el objeto la primera vez que se pide y lo comparte: varias cámaras pueden arrancar a la vez."""
    candado = threading.Lock()
    creado: list[Any] = []

    def obtener() -> Any:
        with candado:
            if not creado:
                creado.append(fabrica())
            return creado[0]

    return obtener


detector_compartido = una_vez(lambda: PoolDetector(crear_detector_placas, ANPR_DETECTORES))
ocr_compartido = una_vez(create_ocr_engine)


def crear_motor(camara_id: int, nombre: str, url: str) -> MotorAnpr:
    def fuente_rtsp(direccion: str) -> RTSPSource:
        fuente = RTSPSource(url=direccion)
        fuente._name = nombre
        return fuente

    return MotorAnpr(
        ConfigMotor(
            backend_url=BACKEND_URL,
            camara_id=camara_id,
            fuente_camara=url,
            rtsp_url=url,
            dir_media=MEDIA_DIR,
            hud_activo=DEBUG_VISUAL,
            ventana_local=DEBUG_SHOW_WINDOW and not RUNNING_IN_DOCKER,
            peso_voto_verificador=OCR_VERIFIER_VOTE_WEIGHT,
            espera_verificador_s=OCR_VERIFIER_MAX_MS / 1000.0,
            presupuesto_registro_s=REGISTRO_MAX_MS / 1000.0 if REGISTRO_MAX_MS > 0 else None,
            confianza_minima_registro=PLATE_REGISTRATION_MIN_CONFIDENCE,
            sin_placa_activo=SIN_PLACA_HABILITADO,
            rescate_cuadros=RESCATE_CUADROS,
            sin_placa=ParametrosSinPlaca(fraccion_vehiculo=SIN_PLACA_FRACCION_VEHICULO),
            espera_sin_placa_s=SIN_PLACA_ESPERA_S,
        ),
        DependenciasMotor(
            crear_fuente_video=lambda: fuente_rtsp(url),
            crear_pipeline=lambda: pipeline_de_camara(detector_compartido()),
            crear_selector=BestFrameSelector,
            crear_motor_ocr=ocr_compartido,
            crear_trabajador_ocr=lambda motor_ocr, al_leer: AsyncOcrWorker(motor_ocr, on_ocr_completed=al_leer),
            verificador=get_verifier,
            reconocedor_vehiculo=get_vehicle_recognizer,
            fuente_rtsp=fuente_rtsp,
            cuadro_espera=cuadro_espera,
            mostrar_ventana=try_imshow,
            cerrar_ventanas=cv2.destroyAllWindows,
            guardar_imagen=cv2.imwrite,
            metricas=metrics,
            logger=get_logger("motor"),
            detector_vehiculos=get_detector_vehiculos,
        ),
        http=httpx.Client(timeout=5.0, headers=BACKEND_HEADERS),
        buffer_video=DebugFrameBuffer(),
    )


#: Modelos cargados, para /status. Hasta terminar la precarga van vacíos: consultarlos no debe esperarla
modelos_cargados: dict = {"detector": None, "detector_arquitectura": None, "ocr_engine": None, "ocr_verifier": None}


def precargar_modelos() -> None:
    """Detector, OCR y verificador en memoria antes de la primera cámara: tarda decenas de segundos."""
    detector = detector_compartido()
    ocr = ocr_compartido()
    verificador = get_verifier()
    modelos_cargados.update(
        detector=os.path.basename(detector.model_path or "") or None,
        detector_arquitectura=detector.arquitectura,
        ocr_engine=f"{getattr(ocr, 'engine_name', '?')} ({getattr(ocr, 'model_id', '?')})",
        ocr_verifier=verificador.description if verificador else None,
    )


gestor = GestorCamaras(crear_motor, ANPR_MAX_CAMARAS, precargar_modelos, lambda: dict(modelos_cargados), get_logger("gestor"))

app = crear_app(gestor)
