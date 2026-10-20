"""
ECU 911 ANPR Microservice — raíz de composición.

Conecta el motor de reconocimiento (app/aplicacion/motor.py) con sus adaptadores reales
(modelos YOLO y OCR, verificador PP-OCRv6, atributos del vehículo, fuentes de video, cliente HTTP
hacia el backend, disco, métricas y registro) y crea el servidor FastAPI (app/interfaz/api.py).

    uvicorn app.main:app

Arquitectura en dos fases: captura fotográfica rápida + OCR asíncrono de alta fidelidad.
"""

from __future__ import annotations

import cv2
import httpx

from app.aplicacion.detector import create_detection_pipeline
from app.aplicacion.frame_selector import BestFrameSelector
from app.aplicacion.motor import ConfigMotor, DependenciasMotor, MotorAnpr
from app.aplicacion.ocr_worker import AsyncOcrWorker
from app.aplicacion.paso_sin_placa import ParametrosSinPlaca
from app.infraestructura import metrics
from app.infraestructura.config import (
    BACKEND_HEADERS,
    BACKEND_URL,
    CAMERA_ID,
    DEBUG_SHOW_WINDOW,
    DEBUG_VISUAL,
    MEDIA_DIR,
    OCR_VERIFIER_MAX_MS,
    REGISTRO_MAX_MS,
    OCR_VERIFIER_VOTE_WEIGHT,
    PLATE_REGISTRATION_MIN_CONFIDENCE,
    RTSP_URL,
    RUNNING_IN_DOCKER,
    SIN_PLACA_ESPERA_S,
    SIN_PLACA_FRACCION_VEHICULO,
    SIN_PLACA_HABILITADO,
)
from app.infraestructura.debug_stream import DebugFrameBuffer, cuadro_espera, try_imshow
from app.infraestructura.logger import get_logger
from app.infraestructura.ocr_engine import create_ocr_engine
from app.infraestructura.ocr_verifier import get_verifier
from app.infraestructura.vehicle_attributes import get_vehicle_recognizer
from app.infraestructura.vehiculos_coco import get_detector_vehiculos
from app.infraestructura.video_source import RTSPSource, create_video_source
from app.interfaz.api import crear_app

motor = MotorAnpr(
    ConfigMotor(
        backend_url=BACKEND_URL,
        camara_id=CAMERA_ID,
        fuente_camara=RTSP_URL,
        rtsp_url=RTSP_URL,
        dir_media=MEDIA_DIR,
        hud_activo=DEBUG_VISUAL,
        ventana_local=DEBUG_SHOW_WINDOW and not RUNNING_IN_DOCKER,
        peso_voto_verificador=OCR_VERIFIER_VOTE_WEIGHT,
        espera_verificador_s=OCR_VERIFIER_MAX_MS / 1000.0,
        presupuesto_registro_s=REGISTRO_MAX_MS / 1000.0 if REGISTRO_MAX_MS > 0 else None,
        confianza_minima_registro=PLATE_REGISTRATION_MIN_CONFIDENCE,
        sin_placa_activo=SIN_PLACA_HABILITADO,
        sin_placa=ParametrosSinPlaca(fraccion_vehiculo=SIN_PLACA_FRACCION_VEHICULO),
        espera_sin_placa_s=SIN_PLACA_ESPERA_S,
    ),
    DependenciasMotor(
        crear_fuente_video=create_video_source,
        crear_pipeline=create_detection_pipeline,
        crear_selector=BestFrameSelector,
        crear_motor_ocr=create_ocr_engine,
        crear_trabajador_ocr=lambda motor_ocr, al_leer: AsyncOcrWorker(motor_ocr, on_ocr_completed=al_leer),
        verificador=get_verifier,
        reconocedor_vehiculo=get_vehicle_recognizer,
        fuente_rtsp=lambda url: RTSPSource(url=url),
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

app = crear_app(motor)
