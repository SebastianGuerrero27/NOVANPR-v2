"""
Control de acceso a los endpoints del microservicio ANPR.

- Endpoints de control (cambio de cámara, previsualización RTSP, MJPEG de depuración):
  encabezado X-Servicio-Token igual a ANPR_SERVICE_TOKEN (solo el backend lo conoce).
- WebSockets de video y pistas: ticket de 60 s emitido por el backend a un usuario con
  sesión válida (HMAC-SHA256 con ANPR_SERVICE_TOKEN sobre {u, a, exp}).
- Estado y métricas (región de interés, modelos, ritmo de la cámara): el token anterior o una
  solicitud del propio contenedor (el healthcheck de Docker). El puerto 8000 se publica para los
  WebSocket, así que cualquier equipo de la red llega hasta aquí.

Sin ANPR_SERVICE_TOKEN (desarrollo local) se permite el acceso con una advertencia.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from app.infraestructura.config import ANPR_SERVICE_TOKEN
from app.infraestructura.logger import get_logger

logger = get_logger("acceso")
_aviso_emitido = False


def _sin_token() -> bool:
    global _aviso_emitido
    if not ANPR_SERVICE_TOKEN:
        if not _aviso_emitido:
            logger.warning("ANPR_SERVICE_TOKEN no definido: endpoints de control y video sin protección (solo desarrollo).")
            _aviso_emitido = True
        return True
    return False


def token_servicio_valido(valor: str | None) -> bool:
    if _sin_token():
        return True
    return bool(valor) and hmac.compare_digest(valor.encode(), ANPR_SERVICE_TOKEN.encode())


def acceso_interno(cliente: str | None, token: str | None) -> bool:
    """Para el estado del motor: el backend (con su token) o una solicitud local del contenedor."""
    return cliente in ("127.0.0.1", "::1") or token_servicio_valido(token)


def _b64decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def ticket_valido(ticket: str | None, alcance: str) -> bool:
    """Verifica firma, vencimiento y alcance ('stream') del ticket del backend."""
    if _sin_token():
        return True
    if not ticket or "." not in ticket:
        return False
    payload, firma = ticket.rsplit(".", 1)
    esperada = base64.urlsafe_b64encode(
        hmac.new(ANPR_SERVICE_TOKEN.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    if not hmac.compare_digest(esperada, firma):
        return False
    try:
        datos = json.loads(_b64decode(payload))
    except (ValueError, json.JSONDecodeError):
        return False
    if int(datos.get("exp", 0)) < time.time():
        return False
    return datos.get("a") == alcance
