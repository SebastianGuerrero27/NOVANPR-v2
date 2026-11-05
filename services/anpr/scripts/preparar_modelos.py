"""
Descarga al construir la imagen los modelos que las bibliotecas bajan por su cuenta (OCR, verificador,
atributos del vehículo), para que el motor funcione en una red sin Internet. Si falta uno, falla la
construcción: es preferible a descubrirlo en la garita. Lee solo config.py, de modo que un cambio en el
código del motor no repite la descarga.
"""

from __future__ import annotations

import importlib.util
import os
import sys

import numpy as np


def cargar_config():
    ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.py")
    spec = importlib.util.spec_from_file_location("config_motor", ruta)
    modulo = importlib.util.module_from_spec(spec)
    sys.modules["config_motor"] = modulo
    spec.loader.exec_module(modulo)
    return modulo


def ocr_rapido(config) -> None:
    from fast_plate_ocr import LicensePlateRecognizer

    # También el modelo de respaldo que usa ocr_engine.py si el principal no carga
    for modelo in {config.PLATE_OCR_HUB_MODEL, "cct-s-v2-global-model"}:
        LicensePlateRecognizer(hub_ocr_model=modelo, device="cpu").run(np.zeros((70, 140, 3), np.uint8))
        print(f"OCR rápido: {modelo}", flush=True)


def verificador(config) -> None:
    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR

    motor = EngineType.OPENVINO if config.OCR_VERIFIER_ENGINE == "openvino" else EngineType.ONNXRUNTIME
    tipo = {"tiny": ModelType.TINY, "small": ModelType.SMALL}.get(config.OCR_VERIFIER_MODEL, ModelType.MEDIUM)
    ocr = RapidOCR(params={
        "Global.log_level": "error", "Global.use_cls": False,
        "Det.engine_type": motor, "Det.model_type": tipo, "Det.ocr_version": OCRVersion.PPOCRV6,
        "Rec.engine_type": motor, "Rec.model_type": tipo, "Rec.ocr_version": OCRVersion.PPOCRV6,
    })
    ocr(np.full((64, 200, 3), 255, np.uint8))
    print(f"Verificador: PP-OCRv6 {tipo.value} ({config.OCR_VERIFIER_ENGINE})", flush=True)


def atributos_vehiculo(config) -> None:
    import open_clip

    open_clip.create_model_and_transforms(config.VEHICLE_CLIP_MODEL, pretrained=config.VEHICLE_CLIP_PRETRAINED)
    open_clip.get_tokenizer(config.VEHICLE_CLIP_MODEL)
    print(f"Atributos del vehículo: {config.VEHICLE_CLIP_MODEL} ({config.VEHICLE_CLIP_PRETRAINED})", flush=True)


if __name__ == "__main__":
    configuracion = cargar_config()
    ocr_rapido(configuracion)
    verificador(configuracion)
    atributos_vehiculo(configuracion)
