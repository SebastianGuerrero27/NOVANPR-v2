#!/usr/bin/env bash
# Instala el Sistema ANPR ECU 911 desde el paquete de producción, sin internet (Linux con Docker Engine
# y Compose v2).
#
#   sudo bash scripts/instalar.sh 192.168.1.50      # la IP del servidor en la LAN
#
# 1) carga las imágenes, 2) crea .env con secretos nuevos (si no existe) y 3) arranca los servicios.
# Se puede repetir: no borra datos ni el .env. Los pesos de los modelos van dentro de la imagen del motor.
set -euo pipefail
cd "$(dirname "$0")/.."

IP="${1:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
if [ -z "$IP" ]; then echo "Indique la IP del servidor: sudo bash scripts/instalar.sh 192.168.1.50"; exit 1; fi
docker compose version >/dev/null 2>&1 || { echo "Falta Docker Compose v2 (docker compose)."; exit 1; }

echo "1/3 Cargando las imágenes (puede tardar varios minutos)..."
docker load -i imagenes/anpr_imagenes.tar

echo "2/3 Configuración (.env)..."
if [ -f .env ]; then
  echo "    .env ya existe: se conserva tal cual."
else
  azar() { head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  cat > .env <<EOF
# Sistema ANPR ECU 911 · generado por scripts/instalar.sh el $(date +%F).
# GUARDE UNA COPIA SEGURA de este archivo: CAMARAS_CLAVE_CIFRADO cifra las contraseñas de las
# cámaras y del correo; si se pierde, hay que volver a escribirlas.
DB_USER=anpr
DB_PASSWORD=$(azar 32)
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
CAMARAS_CLAVE_CIFRADO=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
ANPR_SERVICE_TOKEN=$(azar 40)

# Direcciones con que el personal abre el sistema desde la red local (obligatorias)
FRONTEND_URL=http://$IP:3000
WEBRTC_HOSTS=127.0.0.1,$IP
WEBRTC_PUBLIC_URL=http://$IP:8889
ANPR_PUBLIC_URL=http://$IP:8000

# Redes donde están las cámaras (CIDR separados por coma). Vacío = redes privadas.
# Recomendado: solo la VLAN de cámaras, p. ej. 10.20.30.0/24
CAMARAS_REDES_PERMITIDAS=
EOF
  chmod 600 .env
  echo "    .env creado con secretos nuevos (IP $IP)."
fi

echo "3/3 Arrancando..."
docker compose up -d
docker compose ps
echo
echo "Listo. En 1 a 5 minutos todos los servicios quedan 'healthy' (docker compose ps)."
echo "Abra http://$IP:3000, cree el primer administrador y registre la cámara de la garita."
