"""
Cámaras que analiza este motor (capa de aplicación).

Cada cámara tiene su propio `MotorAnpr`: fuente de video, seguimiento, anti-duplicados, selección del
mejor cuadro y registro son independientes, y una cámara caída no afecta a las demás. Los modelos
(detector, OCR, verificador) se comparten: los carga una sola vez la raíz de composición (app/main.py).

El backend es quien decide: envía la lista completa de cámaras de este motor (`reconciliar`) y aquí se
arrancan las nuevas, se detienen las que ya no están y se corrigen las zonas o la fuente que cambiaron.
Enviar la misma lista otra vez no cambia nada, así que el backend la reenvía periódicamente y un motor
reiniciado retoma sus cámaras solo. `max_camaras` protege la CPU: una lista mayor se rechaza entera.
"""

from __future__ import annotations

import threading
from typing import Any, Callable, Optional

from app.aplicacion.motor import MotorAnpr, UsoCpu


class GestorCamaras:
    def __init__(self, crear_motor: Callable[[int, str, str], MotorAnpr], max_camaras: int,
                 precargar: Callable[[], None], info_modelos: Callable[[], dict], logger: Any) -> None:
        self._crear_motor = crear_motor
        self.max_camaras = max_camaras
        self._precargar = precargar
        self._info_modelos = info_modelos
        self._log = logger
        self._candado = threading.Lock()
        self._motores: dict[int, MotorAnpr] = {}
        self._activo = False
        self._cpu = UsoCpu()

    # ─── Ciclo de vida ──────────────────────────────────────────────────────

    @property
    def activo(self) -> bool:
        return self._activo

    def iniciar(self) -> None:
        self._log.info("Motor ANPR multicámara iniciado (máximo %d cámaras); se esperan las que asigne el backend.", self.max_camaras)
        self._activo = True

    def detener(self) -> None:
        self._activo = False
        with self._candado:
            motores, self._motores = list(self._motores.values()), {}
        for motor in motores:
            motor.detener()

    # ─── Consultas ──────────────────────────────────────────────────────────

    def motor(self, camara_id: Any) -> Optional[MotorAnpr]:
        """Motor de la cámara o None si este motor no la analiza."""
        try:
            with self._candado:
                return self._motores.get(int(camara_id))
        except (TypeError, ValueError):
            return None

    def _lista(self) -> list[MotorAnpr]:
        with self._candado:
            return list(self._motores.values())

    def camaras(self) -> list[dict]:
        """Estado de cada cámara: conexión, zonas, cuadros por segundo, enlace y latencia."""
        resultado = []
        for motor in self._lista():
            estado = motor.estado()
            activa = motor.camara_activa()
            resultado.append({
                "id": motor.camara_id, "iniciada": motor.activo, "conectada": activa["is_connected"],
                "fuente": activa["camera_source"], "roi": activa["roi"], "exclusiones": activa["exclusiones"],
                "capture_fps": estado["capture_fps"], "tracker_fps": estado["tracker_fps"],
                "inferencias_omitidas_pct": estado["inferencias_omitidas_pct"], "enlace_video": estado["enlace_video"],
                "latencia": estado["latencia"], "etapas_ms": estado["etapas_ms"], "seguidor": estado["seguidor"],
                "calidad_captura": estado.get("calidad_captura"),
            })
        return sorted(resultado, key=lambda c: c["id"])

    def uso_cpu(self) -> dict:
        return self._cpu.leer()

    def info_modelos(self) -> dict:
        return self._info_modelos()

    def estado(self) -> dict:
        camaras = self.camaras()
        con_video = [c for c in camaras if c["conectada"]]

        def promedio(campo: str) -> float:
            return round(sum(c[campo] for c in con_video) / len(con_video), 1) if con_video else 0.0

        return {
            "status": "online", "running": self._activo, "max_camaras": self.max_camaras, "camaras": camaras,
            "capture_fps": promedio("capture_fps"), "tracker_fps": promedio("tracker_fps"),
            "cpu": self.uso_cpu(), **self._info_modelos(),
            "architecture": "Multicámara: un motor por cámara con modelos compartidos",
        }

    # ─── Reconciliación ─────────────────────────────────────────────────────

    def reconciliar(self, payload: Any) -> tuple[int, dict]:
        """{"camaras": [{"id", "nombre", "rtsp_url", "roi", "exclusiones"}, …]}: la lista completa de
        cámaras de este motor. Devuelve (código HTTP, cuerpo)."""
        lista = payload.get("camaras") if isinstance(payload, dict) else None
        if not isinstance(lista, list):
            return 400, {"error": "Indique la lista de cámaras"}
        deseadas: dict[int, dict] = {}
        for c in lista:
            try:
                camara_id = int(c["id"])
            except (KeyError, TypeError, ValueError):
                return 400, {"error": "Cada cámara necesita un id numérico"}
            url = c.get("rtsp_url")
            if not isinstance(url, str) or not url.lower().startswith(("rtsp://", "rtsps://")):
                return 400, {"error": f"La cámara {camara_id} necesita una URL RTSP"}
            deseadas[camara_id] = c
        if len(deseadas) > self.max_camaras:
            return 409, {"error": f"Este motor admite hasta {self.max_camaras} cámaras", "max_camaras": self.max_camaras}

        with self._candado:
            retiradas = [self._motores.pop(i) for i in list(self._motores) if i not in deseadas]
            existentes = dict(self._motores)
            nuevas = {i: self._crear_motor(i, str(c.get("nombre") or f"Cámara {i}"), c["rtsp_url"])
                      for i, c in deseadas.items() if i not in existentes}
            self._motores.update(nuevas)

        for motor in retiradas:
            threading.Thread(target=self._retirar, args=(motor,), daemon=True, name="CamaraRetirada").start()
        for camara_id, motor in nuevas.items():
            threading.Thread(target=self._arrancar, args=(camara_id, motor, deseadas[camara_id]), daemon=True, name=f"Camara{camara_id}").start()
        for camara_id, motor in existentes.items():
            self._actualizar(motor, deseadas[camara_id])

        with self._candado:
            return 200, {"success": True, "camaras": sorted(self._motores), "max_camaras": self.max_camaras}

    def _retirar(self, motor: MotorAnpr) -> None:
        self._log.info("Cámara #%d retirada del análisis.", motor.camara_id)
        try:
            # Los registros en curso terminan antes de cerrar la conexión con el backend
            motor.detener(esperar=True)
        except Exception as e:
            self._log.error("Error al detener la cámara #%d: %s", motor.camara_id, e)

    def _arrancar(self, camara_id: int, motor: MotorAnpr, camara: dict) -> None:
        try:
            # Los modelos se cargan con la primera cámara: un motor sin cámaras casi no ocupa memoria
            self._precargar()
            motor.iniciar()
            motor.fijar_roi({"roi": camara.get("roi"), "exclusiones": camara.get("exclusiones") or []})
            self._log.info("Cámara #%d (%s) en análisis.", camara_id, camara.get("nombre"))
        except Exception as e:
            # Se olvida para que la próxima reconciliación la reintente
            self._log.error("No se pudo iniciar la cámara #%d: %s", camara_id, e)
            with self._candado:
                if self._motores.get(camara_id) is motor:
                    del self._motores[camara_id]

    def _actualizar(self, motor: MotorAnpr, camara: dict) -> None:
        """Corrige lo que cambió en una cámara que ya está en análisis. Si aún está arrancando, la
        próxima reconciliación encuentra su pipeline listo."""
        if motor.pipeline is None:
            return
        if motor.fuente_camara != camara["rtsp_url"]:
            motor.cambiar_camara({"camera_id": motor.camara_id, "rtsp_url": camara["rtsp_url"], "nombre": camara.get("nombre"),
                                  "roi": camara.get("roi"), "exclusiones": camara.get("exclusiones") or []})
            return
        zonas = motor.camara_activa()
        if zonas["roi"] != camara.get("roi") or zonas["exclusiones"] != (camara.get("exclusiones") or []):
            motor.fijar_roi({"roi": camara.get("roi"), "exclusiones": camara.get("exclusiones") or []})
