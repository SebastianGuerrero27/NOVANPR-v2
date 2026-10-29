"""Últimos 30 s de la cámara para la foto de evidencia del registro manual."""
import numpy as np

from app.aplicacion.historial_cuadros import HistorialCuadros


def cuadro(valor: int) -> np.ndarray:
    return np.full((360, 640, 3), valor, np.uint8)


def test_guarda_dos_cuadros_por_segundo_de_los_ultimos_30_s():
    h = HistorialCuadros(en_hilo=False)
    for i in range(400):            # 40 s a 10 cuadros por segundo
        h.ofrecer(cuadro(i % 255), i / 10)
    horas = [t for t, _ in h.miniaturas()]
    assert horas[0] == 39.5 and horas == sorted(horas, reverse=True)
    assert 9.5 <= horas[-1] <= 10.0 and len(horas) == 61
    mini = h.miniaturas()[0][1]
    assert mini[:2] == b"\xff\xd8"          # JPEG


def test_la_foto_es_el_cuadro_completo_mas_cercano_y_vence_a_los_30_s():
    h = HistorialCuadros(en_hilo=False)
    for i in range(400):
        h.ofrecer(cuadro(100), i / 10)
    foto = h.foto(30.1)
    assert foto is not None and foto[:2] == b"\xff\xd8" and len(foto) > len(h.miniaturas()[0][1])
    assert h.foto(5.0) is None              # más de 30 s atrás
    h.reiniciar()
    assert h.miniaturas() == [] and h.foto(39.5) is None
