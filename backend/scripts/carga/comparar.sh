#!/usr/bin/env bash
# Comparación A/B pareada de dos imágenes del backend sobre la MISMA base de datos sembrada:
#   bash backend/scripts/carga/comparar.sh <imagen-A> <imagen-B> <dir-salida> [rondas] [archivo-de-secretos]
# Alterna A B A B en la misma corrida (los tiempos de este portátil varían 2-3x entre corridas) y quita
# los índices nuevos antes de cada A para medirla como estaba. No correr otras cargas en paralelo.
set -uo pipefail
IMAGEN_A="$1"; IMAGEN_B="$2"; SALIDA="$3"; RONDAS="${4:-2}"; SECRETOS="${5:-}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$AQUI/entorno.sh" "$SECRETOS"
export CARGA_USUARIO_ID="${CARGA_USUARIO_ID:-1}"
mkdir -p "$SALIDA"

psql_carga() { docker compose exec -T db psql -U anpr -d ANPR_ECU911 -qAt "$@"; }
listo() { timeout 180 bash -c 'until curl -sf http://127.0.0.1:5055/health/ready >/dev/null; do sleep 1; done'; }
arrancar() {
  local inicio=$SECONDS
  IMAGEN_BACKEND="$1" docker compose up -d --force-recreate --no-deps backend >/dev/null 2>&1
  listo || { echo "El backend $1 no quedó listo"; docker logs --tail 20 anpr-carga-backend-1; exit 1; }
  echo "  $1 listo en $((SECONDS - inicio)) s"
}
medir() {
  local etiqueta="$1"
  ( cd "$AQUI"
    node medir.mjs secuencial --repeticiones 3 > "$SALIDA/${etiqueta}_secuencial.json"
    node medir.mjs concurrente --segundos 20 --niveles 1,5,10,25,50 > "$SALIDA/${etiqueta}_concurrente.json"
    node medir.mjs bloqueo --ruta /api/auth/login --metodo POST --concurrencia 30 \
      --cuerpo '{"email":"carga.admin@prueba.invalid","password":"ClaveDeCarga-2026!"}' > "$SALIDA/${etiqueta}_login.json" )
}

for ronda in $(seq 1 "$RONDAS"); do
  echo "Ronda $ronda · A = $IMAGEN_A"
  docker compose stop backend >/dev/null 2>&1
  psql_carga -c "DROP INDEX IF EXISTS ix_deteccion_autorizado, ix_deteccion_alerta, ix_deteccion_validador, ix_deteccion_placa_normalizada, ix_deteccion_cola"
  arrancar "$IMAGEN_A"; medir "A${ronda}"
  echo "Ronda $ronda · B = $IMAGEN_B"
  arrancar "$IMAGEN_B"; psql_carga -c "ANALYZE deteccionvehiculo"; medir "B${ronda}"
done
echo "Listo: $SALIDA"
