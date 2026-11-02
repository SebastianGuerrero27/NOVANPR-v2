# Variables del banco de pruebas: `source backend/scripts/carga/entorno.sh [archivo-de-secretos]`.
# Genera secretos de un solo uso la primera vez y los guarda fuera del repositorio.
_secretos="${1:-${TMPDIR:-/tmp}/anpr_carga.env}"
if [ ! -f "$_secretos" ]; then
  umask 077
  {
    echo "CARGA_DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
    echo "CARGA_JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
    echo "CARGA_CLAVE_CIFRADO=$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    echo "CARGA_SERVICE_TOKEN=$(head -c 30 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
  } > "$_secretos"
fi
set -a; . "$_secretos"; set +a
export COMPOSE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && (pwd -W 2>/dev/null || pwd))/docker-compose.carga.yml"
export MSYS_NO_PATHCONV=1
