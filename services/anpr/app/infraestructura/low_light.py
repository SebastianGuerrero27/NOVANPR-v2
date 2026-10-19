"""Detección ligera de baja iluminación y realce conservador para el flujo ANPR."""

from __future__ import annotations

import cv2
import numpy as np


_LOW_LIGHT_MEAN_MAX = 70.0
_LOW_LIGHT_P75_MAX = 105.0


def _sample_luminance(image: np.ndarray) -> np.ndarray:
    """Mide luminancia en una muestra pequeña para limitar el coste por fotograma."""
    height, width = image.shape[:2]
    sample = cv2.resize(image, (min(width, 160), min(height, 120)), interpolation=cv2.INTER_AREA)
    if sample.ndim == 2:
        return sample
    if sample.ndim == 3 and sample.shape[2] >= 3:
        return cv2.cvtColor(sample[:, :, :3], cv2.COLOR_BGR2GRAY)
    raise ValueError(f"Formato de imagen no compatible para ANPR: {image.shape}")


def is_low_light(image: np.ndarray) -> bool:
    """Activa el realce si la escena completa está oscura, no solo por un área de sombra."""
    if image is None or image.size == 0:
        return False
    luminance = _sample_luminance(image)
    mean = float(np.mean(luminance))
    percentile_75 = float(np.percentile(luminance, 75))
    return mean < _LOW_LIGHT_MEAN_MAX and percentile_75 < _LOW_LIGHT_P75_MAX


def enhance_low_light(image: np.ndarray) -> np.ndarray:
    """Realza luminancia con gamma adaptativa y CLAHE, solo cuando la escena está oscura.

    La geometría y dimensiones permanecen iguales, por lo que las cajas YOLO siguen
    correspondiendo al fotograma original que se muestra y se usa para las capturas.
    """
    if image is None or image.size == 0 or not is_low_light(image):
        return image

    luminance = _sample_luminance(image)
    mean = float(np.mean(luminance))
    gamma = float(np.clip(0.55 + 0.25 * mean / _LOW_LIGHT_MEAN_MAX, 0.55, 0.80))
    lut = np.clip(
        np.power(np.arange(256, dtype=np.float32) / 255.0, gamma) * 255.0,
        0,
        255,
    ).astype(np.uint8)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    if image.ndim == 2:
        corrected = cv2.LUT(image, lut)
        return clahe.apply(corrected)
    if image.ndim != 3 or image.shape[2] < 3:
        raise ValueError(f"Formato de imagen no compatible para ANPR: {image.shape}")

    bgr = image[:, :, :3]
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    gamma_luminance = cv2.LUT(l_channel, lut)
    enhanced_luminance = clahe.apply(gamma_luminance)
    enhanced = cv2.cvtColor(
        cv2.merge((enhanced_luminance, a_channel, b_channel)),
        cv2.COLOR_LAB2BGR,
    )
    if image.shape[2] == 4:
        return np.dstack((enhanced, image[:, :, 3]))
    return enhanced
