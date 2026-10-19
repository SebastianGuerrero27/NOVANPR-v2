"""Pruebas del realce adaptativo de luminancia usado por YOLO y por el OCR."""

import numpy as np

from app.infraestructura.low_light import enhance_low_light, is_low_light


def test_low_light_detects_a_dark_scene_with_a_small_bright_plate():
    frame = np.full((240, 320, 3), 8, dtype=np.uint8)
    frame[150:170, 130:200] = 180
    frame[155:165, 140:150] = 15

    assert is_low_light(frame)


def test_day_scene_does_not_enable_enhancement():
    frame = np.full((240, 320, 3), 130, dtype=np.uint8)
    frame[40:200, 30:90] = 10

    assert not is_low_light(frame)
    assert enhance_low_light(frame) is frame


def test_night_enhancement_preserves_size_type_and_source():
    frame = np.full((120, 160, 3), 12, dtype=np.uint8)
    frame[45:75, 45:115] = 110
    original = frame.copy()

    enhanced = enhance_low_light(frame)

    assert enhanced.shape == frame.shape
    assert enhanced.dtype == frame.dtype
    assert not np.array_equal(enhanced, frame)
    assert float(np.median(enhanced)) > float(np.median(frame))
    assert np.array_equal(frame, original)


def test_night_enhancement_supports_grayscale():
    frame = np.full((100, 160), 10, dtype=np.uint8)

    enhanced = enhance_low_light(frame)

    assert enhanced.shape == frame.shape
    assert enhanced.dtype == frame.dtype
    assert float(np.median(enhanced)) > float(np.median(frame))


def test_plate_agent_uses_exposure_correction_for_dark_ocr_crops():
    from app.aplicacion.plate_agent import PlateEnhancementAgent

    crop = np.full((40, 120, 3), 12, dtype=np.uint8)
    crop[12:28, 25:95] = 100
    agent = PlateEnhancementAgent.__new__(PlateEnhancementAgent)

    enhanced = agent._apply_scientific_enhancement(crop)

    assert enhanced.shape[0] == 140
    assert enhanced.shape[1] > crop.shape[1]
    assert float(np.median(enhanced)) > float(np.median(crop))
