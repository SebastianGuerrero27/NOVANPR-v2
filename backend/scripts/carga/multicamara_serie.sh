#!/bin/bash
# Serie de mediciones del motor con varias cámaras.
#   VIDEO_CLIP=clip.mp4 VERDAD=placas.txt ROI=zona.json SALIDA=carpeta bash multicamara_serie.sh
# Una corrida ya guardada no se repite. No correr pruebas ni compilar en paralelo: contaminaría las cifras.
set -u
D="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
source "$D/entorno.sh" "${SECRETOS:-${TMPDIR:-/tmp}/anpr_carga.env}"
unset COMPOSE_FILE
export VIDEO_CLIP
SEGUNDOS="${SEGUNDOS:-360}"
ESPERADAS="${ESPERADAS:-10}"
mkdir -p "$SALIDA"

corrida() {  # etiqueta cámaras motores
  local etiqueta="$1" camaras="$2" motores="$3"
  [ -f "$SALIDA/$etiqueta.json" ] && { echo "== $etiqueta ya medida"; return; }
  echo "== $(date +%H:%M:%S) $etiqueta: $camaras cámaras, $motores motores"
  python "$D/multicamara.py" --camaras "$camaras" --motores "$motores" --segundos "$SEGUNDOS" --esperadas "$ESPERADAS" \
    --verdad "$VERDAD" --roi "$ROI" --etiqueta "$etiqueta" --salida "$SALIDA/$etiqueta.json" \
    ${REGISTROS:+--registros "$REGISTROS/$etiqueta.log"} || echo "!! $etiqueta falló"
}

# Cuántas cámaras admite un motor. Las diferencias de 1 o 2 lecturas entre corridas son ruido normal
corrida una_camara 1 1
corrida dos_camaras 2 1
corrida cuatro_camaras 4 1
corrida seis_camaras 6 1
# Un proceso por cámara, en un mismo equipo: compiten por la misma CPU
corrida procesos_4 4 4
echo "== $(date +%H:%M:%S) fin"
