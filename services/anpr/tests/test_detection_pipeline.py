"""
Pruebas Unitarias para DetectionPipeline con Inyección de Dependencias (MockDetector).
Verifica:
1. Inyección de MockDetector (cero dependencia de GPU o archivos .pt).
2. Seguimiento ByteTrack y Kalman en detect_and_track.
3. Consenso temporal ponderado de placas ecuatorianas ANT.
4. Limpieza de memoria (clear_all_tracks).
5. La única fuente es la cámara RTSP: no hay detección de cuadros del navegador.
"""

import unittest
import numpy as np

from app.dominio.models import Detection
from app.infraestructura.detectors import MockDetector
from app.aplicacion.movimiento import CompuertaInferencia
from app.aplicacion.detector import (
    _COLOR_LEIDA,
    DetectionPipeline,
    TrackedPlateROI,
    is_valid_ecuador_plate,
)


class TestDetectionPipelineDI(unittest.TestCase):
    def setUp(self):
        # Frame dummy (480x640 BGR)
        self.frame = np.full((480, 640, 3), 128, dtype=np.uint8)

        # Mock detections: placa con aspecto ratio válido para Ecuador (bw=120, bh=40 -> AR=3.0)
        self.mock_det = MockDetector([
            Detection(bbox=[100.0, 150.0, 220.0, 190.0], confidence=0.88, class_name="plate")
        ])

        # Pipeline instanciado mediante Inyección de Dependencias
        self.pipeline = DetectionPipeline(detector=self.mock_det)

    def test_dependency_injection_instantiation(self):
        """Verifica que el pipeline se inicializa con el detector inyectado sin tocar disco ni GPU."""
        self.assertIs(self.pipeline.detector, self.mock_det)
        self.assertEqual(len(self.pipeline._trackers), 0)

    def test_solo_fuente_rtsp_sin_api_del_navegador(self):
        """La webcam del navegador se retiró: no queda detección ni consenso de cuadros del navegador."""
        for retirado in ("detect_fast", "browser_detector", "update_browser_track_plate", "get_browser_track_info"):
            self.assertFalse(hasattr(self.pipeline, retirado), retirado)

    def test_detect_and_track_with_mock(self):
        """Verifica que detect_and_track ejecuta ByteTrack y retorna TrackedPlateROI."""
        # Frame 1: crea track inicial
        rois1 = self.pipeline.detect_and_track(self.frame)
        self.assertIsInstance(rois1, list)
        self.assertGreaterEqual(len(rois1), 1)
        roi = rois1[0]
        self.assertIsInstance(roi, TrackedPlateROI)
        self.assertGreaterEqual(roi.confidence, 0.18)
        self.assertEqual(len(roi.plate_bbox), 4)

        # Frame 2: mantiene el tracking del mismo ID
        first_id = roi.tracking_id
        rois2 = self.pipeline.detect_and_track(self.frame)
        self.assertEqual(rois2[0].tracking_id, first_id)

    def test_dark_scene_is_enhanced_only_for_inference(self):
        night_frame = np.full((480, 640, 3), 8, dtype=np.uint8)
        original = night_frame.copy()
        self.pipeline._compuerta = CompuertaInferencia(activa=False)
        received = []
        predict = self.mock_det.predict

        def capture_inference_frame(frame):
            received.append(frame.copy())
            return predict(frame)

        self.mock_det.predict = capture_inference_frame

        self.pipeline.detect_and_track(night_frame)

        self.assertEqual(len(received), 1)
        self.assertEqual(received[0].shape, night_frame.shape)
        self.assertGreater(float(np.median(received[0])), float(np.median(night_frame)))
        self.assertTrue(np.array_equal(night_frame, original))

    def test_low_confidence_detection_needs_two_consistent_inferences_to_start_track(self):
        weak_plate = Detection(
            bbox=[100.0, 150.0, 220.0, 190.0],
            confidence=0.12,
            class_name="plate",
        )
        self.mock_det.set_detections([weak_plate])

        self.assertEqual(self.pipeline.detect_and_track(self.frame), [])
        self.assertEqual(len(self.pipeline._trackers), 0)

        weak_plate = Detection(
            bbox=[112.0, 150.0, 232.0, 190.0],
            confidence=0.11,
            class_name="plate",
        )
        self.mock_det.set_detections([weak_plate])
        rois = self.pipeline.detect_and_track(self.frame)
        self.assertEqual(rois, [])
        self.assertEqual(len(self.pipeline._trackers), 1)

        self.mock_det.set_detections([
            Detection(
                bbox=[124.0, 150.0, 244.0, 190.0],
                confidence=0.23,
                class_name="plate",
            )
        ])
        rois = self.pipeline.detect_and_track(self.frame)
        self.assertEqual(len(rois), 1)
        self.assertEqual(rois[0].confidence, 0.23)

    def test_isolated_low_confidence_detection_does_not_create_track(self):
        weak_plate = Detection(
            bbox=[100.0, 150.0, 220.0, 190.0],
            confidence=0.12,
            class_name="plate",
        )
        self.mock_det.set_detections([weak_plate])
        self.assertEqual(self.pipeline.detect_and_track(self.frame), [])

        self.mock_det.set_detections([])
        self.assertEqual(self.pipeline.detect_and_track(self.frame), [])
        self.assertEqual(len(self.pipeline._trackers), 0)

        self.mock_det.set_detections([weak_plate])
        self.assertEqual(self.pipeline.detect_and_track(self.frame), [])
        self.assertEqual(len(self.pipeline._trackers), 0)

    def test_coordenadas_dentro_del_cuadro(self):
        """Las cajas de las pistas quedan dentro del cuadro (son las que dibuja el HUD)."""
        h, w = self.frame.shape[:2]
        for roi in self.pipeline.detect_and_track(self.frame):
            x1, y1, x2, y2 = roi.plate_bbox
            self.assertTrue(0 <= x1 < x2 <= w and 0 <= y1 < y2 <= h, roi.plate_bbox)

    def test_ecuador_plate_validation_and_consensus(self):
        """Verifica la validación oficial de placas ANT Ecuador y el consenso ponderado."""
        self.assertTrue(is_valid_ecuador_plate("PSY589"))
        self.assertTrue(is_valid_ecuador_plate("PBA1234"))
        self.assertTrue(is_valid_ecuador_plate("PB1234"))
        self.assertFalse(is_valid_ecuador_plate("NOTAPLATE12345"))
        self.assertFalse(is_valid_ecuador_plate("123"))

        # El consenso ponderado debe preferir lecturas válidas
        tid = 42
        self.pipeline.update_track_plate(tid, "PSY0589", confidence=0.90)
        self.pipeline.update_track_plate(tid, "PSY0589", confidence=0.88)
        # Ruido de OCR no debe desplazar al ganador
        self.pipeline.update_track_plate(tid, "RU1D0", confidence=0.30)

        info = self.pipeline.get_track_info(tid)
        self.assertEqual(info.get("plate"), "PSY0589")

    def test_el_hud_deja_de_dibujar_la_placa_que_el_detector_ya_no_ve(self):
        """A 3 análisis por segundo, la caja se dibuja hasta 0,5 s después de la última detección
        (antes: 4 análisis, 1,3 s de una caja quieta sobre el pavimento al salir el vehículo); la
        pista sigue en el seguimiento por si la placa reaparece."""
        def analizar():
            # Paso del Kalman de 1/3 s, como en el portátil sin GPU
            self.pipeline._paso_kalman_s, self.pipeline._ultimo_paso_kalman = 1 / 3, None
            return self.pipeline.detect_and_track(self.frame)

        tid = analizar()[0].tracking_id
        self.pipeline.update_track_plate(tid, "PBA1234", confidence=0.9)
        analizar()
        self.assertEqual([o.tracking_id for o in self.pipeline._current_overlays], [tid])
        self.mock_det.set_detections([])
        analizar()  # 0,33 s sin verla: aún se dibuja
        self.assertEqual(len(self.pipeline._current_overlays), 1)
        rois = analizar()  # 0,67 s: ya no se dibuja, pero sigue en seguimiento
        self.assertEqual(self.pipeline._current_overlays, [])
        self.assertEqual([r.tracking_id for r in rois], [tid])

    def test_un_solo_analisis_sin_ver_la_placa_no_oculta_la_caja(self):
        """Tras una escena quieta el paso del Kalman puede durar 1 s: una sola detección fallida no
        debe ocultar la caja (solo dos seguidas y más de 0,5 s)."""
        def analizar():
            self.pipeline._paso_kalman_s, self.pipeline._ultimo_paso_kalman = 1.0, None
            return self.pipeline.detect_and_track(self.frame)

        tid = analizar()[0].tracking_id
        self.pipeline.update_track_plate(tid, "PBA1234", confidence=0.9)
        analizar()
        self.mock_det.set_detections([])
        analizar()
        self.assertEqual([o.tracking_id for o in self.pipeline._current_overlays], [tid])
        analizar()
        self.assertEqual(self.pipeline._current_overlays, [])

    def test_clear_all_tracks(self):
        """Verifica que clear_all_tracks reinicie toda la memoria de tracking y consenso."""
        self.pipeline.detect_and_track(self.frame)
        self.pipeline.update_track_plate(1, "PBA1234", 0.9)

        self.pipeline.clear_all_tracks()
        self.assertEqual(len(self.pipeline._trackers), 0)
        self.assertEqual(self.pipeline.get_track_info(1), {})

    def test_retirar_un_rotulo_limpia_su_hud_y_no_afecta_a_otras_placas(self):
        tid = self.pipeline.detect_and_track(self.frame)[0].tracking_id
        self.pipeline.update_track_plate(tid, "QIH6060", 0.99, "leida")
        self.pipeline.update_track_plate(tid + 100, "PBA1234", 0.97, "leida")
        self.pipeline.detect_and_track(self.frame)
        self.assertTrue(any(o.tracking_id == tid for o in self.pipeline._current_overlays))

        self.pipeline.retirar_lectura(tid)

        self.assertFalse(any(o.tracking_id == tid for o in self.pipeline._current_overlays))
        info = self.pipeline.get_track_info(tid)
        self.assertEqual((info["plate"], info["confidence"], info["lecturas"]), ("", 0.0, 0))
        self.assertTrue(info["texto_no_matricula"])
        self.assertEqual(dict(self.pipeline.conteo_lecturas(tid)), {})
        self.assertEqual(self.pipeline.get_track_info(tid + 100)["plate"], "PBA1234")

    def test_una_lectura_rapida_tardia_no_reintroduce_el_rotulo_tras_retirarlo(self):
        tid = self.pipeline.detect_and_track(self.frame)[0].tracking_id
        self.pipeline.update_track_plate(tid, "QIH6060", 0.99, "leida")
        self.pipeline.retirar_lectura(tid)
        self.pipeline.fijar_estado_backend(tid, "pendiente_revision")
        self.pipeline.update_track_plate(tid, "QIH6060", 0.99, "leida")
        self.pipeline.detect_and_track(self.frame)

        info = self.pipeline.get_track_info(tid)
        self.assertEqual(info["plate"], "")
        self.assertEqual(info["status"], "pendiente_revision")
        self.assertEqual(self.pipeline._track_plates[tid]["votes"], {})
        self.assertFalse(any(o.tracking_id == tid for o in self.pipeline._current_overlays))

    def test_retirar_lectura_tambien_limpia_el_consenso_de_una_pista_recien_terminada(self):
        self.pipeline.update_track_plate(42, "QIH6060", 0.99, "leida")
        entry = self.pipeline._track_plates.pop(42)
        self.pipeline._retirados[42] = (0.0, entry, None)

        self.pipeline.retirar_lectura(42)
        self.pipeline.update_track_plate(42, "QIH6060", 0.99, "leida")

        self.assertEqual(self.pipeline.get_track_info(42)["plate"], "")
        self.assertEqual(dict(self.pipeline.conteo_lecturas(42)), {})
        self.assertEqual(self.pipeline._retirados[42][1]["plate"], "")

    def test_un_hud_en_construccion_no_republica_la_lectura_que_acaba_de_retirarse(self):
        """Reproduce el orden de la carrera sin hilos ni temporizadores: retiro antes del commit."""
        from unittest.mock import patch
        from app.aplicacion import detector as modulo_detector

        tid = self.pipeline.detect_and_track(self.frame)[0].tracking_id
        self.pipeline.update_track_plate(tid, "QIH6060", 0.99, "leida")
        construir = modulo_detector.VisualOverlayBox

        def retirar_antes_del_commit(**datos):
            overlay = construir(**datos)
            self.pipeline.retirar_lectura(datos["tracking_id"])
            return overlay

        with patch.object(modulo_detector, "VisualOverlayBox", side_effect=retirar_antes_del_commit):
            self.pipeline.detect_and_track(self.frame)

        self.assertTrue(self.pipeline.get_track_info(tid)["texto_no_matricula"])
        self.assertEqual(self.pipeline._current_overlays, [])

    def test_pista_leida_muestra_la_placa_y_luego_el_estado_del_backend(self):
        tid = self.pipeline.detect_and_track(self.frame)[0].tracking_id
        self.pipeline.update_track_plate(tid, "PBA1234", 0.95, "leida")
        self.pipeline.detect_and_track(self.frame)
        ov = self.pipeline._current_overlays[0]
        self.assertEqual(ov.placa, "PBA1234")
        self.assertTrue(ov.label.startswith("PBA-1234"), ov.label)
        self.assertEqual(ov.color, _COLOR_LEIDA)

        self.pipeline.fijar_estado_backend(tid, "alerta")
        self.pipeline.detect_and_track(self.frame)
        ov = self.pipeline._current_overlays[0]
        self.assertEqual((ov.estado, ov.label), ("alerta", "PBA-1234  ALERTA"))


if __name__ == "__main__":
    unittest.main()
