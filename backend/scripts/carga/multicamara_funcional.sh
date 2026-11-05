#!/bin/bash
# Prueba funcional con dos motores de 2 cámaras cada uno (multicamara_funcional.mjs).
#   VIDEO_CLIP=clip.mp4 bash backend/scripts/carga/multicamara_funcional.sh
# Datos desechables: la base vive en memoria y todo se borra al terminar.
set -u
D="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
source "$D/entorno.sh" "${SECRETOS:-${TMPDIR:-/tmp}/anpr_carga.env}"
unset COMPOSE_FILE
export VIDEO_CLIP
export MOTORES=http://anpr:8000,http://anpr2:8000 MOTORES_PUBLICOS=http://localhost:18000,http://localhost:18001 ANPR_MAX_CAMARAS=2
C=(docker compose -p anpr-multicamara -f "$D/docker-compose.multicamara.yml" --profile varios-motores)

"${C[@]}" down -v --remove-orphans >/dev/null 2>&1
"${C[@]}" up -d db camaras mediamtx backend anpr anpr2 || exit 1
for _ in $(seq 1 90); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$("${C[@]}" ps -q backend)")" = healthy ] && break
  sleep 2
done
CARGA_USUARIO_ID=$("${C[@]}" exec -T db psql -U anpr -d ANPR_ECU911 -qAt -c "
  INSERT INTO usuarios (email, nombre_completo, password_hash, rol_id, estado, email_verificado)
  SELECT 'carga.admin@prueba.invalid', 'Admin de carga', '\$2a\$12\$' || repeat('x', 53), r.id, 'activo', true
  FROM roles r WHERE r.codigo = 'ADMIN' RETURNING id;" | tr -d '\r\n ')
export CARGA_USUARIO_ID
node "$D/multicamara_funcional.mjs"
codigo=$?
[ -n "${CONSERVAR:-}" ] || "${C[@]}" down -v --remove-orphans >/dev/null 2>&1
exit $codigo
