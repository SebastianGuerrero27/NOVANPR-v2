# Motor ANPR (FastAPI). Base fijada a la versión validada: Python 3.12.15 sobre Debian 13.
FROM python:3.12.15-slim-trixie

# Bibliotecas del sistema: OpenCV (libGL, glib), OpenMP (PyTorch) y FFmpeg (ffprobe para el
# diagnóstico de flujos de cámara)
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Ultralytics no instala paquetes por su cuenta en ejecución: las versiones son las del bloqueo
ENV YOLO_AUTOINSTALL=false \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Versiones exactas validadas (requirements.txt; las directas están en requirements.in). PyTorch
# solo CPU: el despliegue no usa GPU (el índice va dentro de requirements.txt)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ultralytics sin conexiones en ejecución: ni telemetría de uso (activa por omisión al terminar cada
# predicción), ni comprobación de versiones, ni descargas; los pesos van en la imagen (models/, *.pt)
ENV YOLO_OFFLINE=true \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

# Modelos que las bibliotecas descargan (OCR, verificador, atributos) dentro de la imagen, fuera de /app
# y de /root: el motor funciona sin Internet y sin depender de un volumen. Va antes de copiar el código
# para no repetir la descarga con cada cambio
ENV HOME=/opt/anpr
COPY scripts/preparar_modelos.py app/infraestructura/config.py /tmp/modelos/
RUN mkdir -p "$HOME" && python /tmp/modelos/preparar_modelos.py && rm -rf /tmp/modelos
ENV HF_HUB_OFFLINE=1

COPY . .

EXPOSE 8000

# Producción, sin recarga automática (docker-compose.yml agrega --reload para desarrollo)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
