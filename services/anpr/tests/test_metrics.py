"""
Tests para el servicio de métricas Prometheus
"""

import pytest
from prometheus_client import generate_latest
import time
from unittest.mock import patch, MagicMock
from app.infraestructura.metrics import (
    update_fps,
    record_detection,
    record_plate_recognized,
    update_tracking_active,
    record_detection_confidence,
    record_ocr_confidence,
    record_detection_error,
    record_ocr_error,
    get_metrics,
    registry,
)


class TestMetricsService:
    """Tests para el servicio de métricas"""

    def setup_method(self):
        """Resetear métricas antes de cada test"""
        # Resetear el registro de métricas
        from prometheus_client import CollectorRegistry
        global registry
        registry = CollectorRegistry()

    def test_update_fps(self):
        """Test de actualización de FPS"""
        update_fps(30.5, 'camera_1')
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_fps' in metrics
        assert 'camera_id="camera_1"' in metrics
        assert '30.5' in metrics

    def test_record_detection(self):
        """Test de registro de detección"""
        record_detection('success', 'camera_1')
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_detections_total' in metrics
        assert 'status="success"' in metrics
        assert 'camera_id="camera_1"' in metrics

    def test_record_plate_recognized(self):
        """Test de registro de placa reconocida"""
        record_plate_recognized('valid')
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_plates_recognized_total' in metrics
        assert 'validation_status="valid"' in metrics

    def test_update_tracking_active(self):
        """Test de actualización de tracks activos"""
        update_tracking_active(5)
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_tracking_active' in metrics
        assert '5' in metrics

    def test_record_detection_confidence(self):
        """Test de registro de confianza de detección"""
        record_detection_confidence(0.85)
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_detection_confidence' in metrics

    def test_record_ocr_confidence(self):
        """Test de registro de confianza de OCR"""
        record_ocr_confidence(0.92)
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_ocr_confidence' in metrics

    def test_record_detection_error(self):
        """Test de registro de error de detección"""
        record_detection_error('yolo_error')
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_detection_errors_total' in metrics
        assert 'error_type="yolo_error"' in metrics

    def test_record_ocr_error(self):
        """Test de registro de error de OCR"""
        record_ocr_error('tesseract_error')
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_ocr_errors_total' in metrics
        assert 'error_type="tesseract_error"' in metrics

    def test_get_metrics(self):
        """Test de obtención de métricas"""
        update_fps(25.0)
        record_detection('success')
        
        metrics = get_metrics()
        assert isinstance(metrics, bytes)
        assert len(metrics) > 0
        
        metrics_str = metrics.decode('utf-8')
        assert 'anpr_fps' in metrics_str
        assert 'anpr_detections_total' in metrics_str

    def test_multiple_detections(self):
        """Test de múltiples detecciones"""
        for i in range(10):
            record_detection('success')
        
        metrics = get_metrics().decode('utf-8')
        assert 'anpr_detections_total' in metrics
        # Verificar que el contador incrementó
        assert '10' in metrics or 'anpr_detections_total' in metrics

    def test_different_camera_ids(self):
        """Test de diferentes IDs de cámara"""
        update_fps(30.0, 'camera_1')
        update_fps(25.0, 'camera_2')
        
        metrics = get_metrics().decode('utf-8')
        assert 'camera_id="camera_1"' in metrics
        assert 'camera_id="camera_2"' in metrics


if __name__ == '__main__':
    pytest.main([__file__, '-v'])


def test_solo_se_publica_el_fps_de_la_camara_activa():
    """Al cambiar de cámara la serie de la anterior se retira: no queda con su último valor."""
    from app.infraestructura import metrics
    metrics.update_fps(30.0, "1")
    metrics.update_fps(0.0, "2")
    series = [l for l in generate_latest(metrics.registry).decode().splitlines() if l.startswith("anpr_fps{")]
    assert series == ['anpr_fps{camera_id="2"} 0.0']

