#!/usr/bin/env bash
# Arma el paquete de producción para instalar sin internet (LEEME_DESPLIEGUE.txt) a partir del commit
# actual: compila las imágenes, las guarda con docker save y comprime todo en un .rar (o .tar.gz si no
# hay WinRAR).
#
#   bash despliegue/empaquetar.sh [carpeta de salida]      # por omisión, la carpeta que contiene el repo
#
# Exige el árbol sin cambios en lo que se empaqueta: lo que va en las imágenes es exactamente el commit.
# El paquete no lleva .env, base de datos, cámaras, usuarios ni fotos.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
RAIZ="$PWD"
SALIDA="$(cd "${1:-..}" && pwd)"
COMMIT="$(git rev-parse --short=8 HEAD)"
FECHA="$(date +%F)"
NOMBRE=NOVANPR_produccion
IMAGENES=(anpr-backend:produccion anpr-frontend:produccion anpr-motor:produccion postgres:17-alpine bluenviron/mediamtx:1.21.3)

sucios="$(git status --porcelain -- backend frontend services/anpr db mediamtx docker-compose.prod.yml .env.example despliegue)"
if [ -n "$sucios" ]; then
  echo "Hay cambios sin commit en lo que se empaqueta; haga commit o descártelos antes:"; echo "$sucios"; exit 1
fi
# Pesos oficiales del detector de vehículos (fuera de git): la imagen del motor los lleva
[ -f services/anpr/yolo26n.pt ] || { echo "Falta services/anpr/yolo26n.pt (YOLO26n oficial de Ultralytics)."; exit 1; }
for imagen in postgres:17-alpine bluenviron/mediamtx:1.21.3; do
  docker image inspect "$imagen" >/dev/null 2>&1 || docker pull "$imagen"
done

echo "1/5 Compilando las imágenes del commit $COMMIT..."
docker build -q -f backend/Dockerfile.prod -t anpr-backend:produccion .
docker build -q -f frontend/Dockerfile.prod -t anpr-frontend:produccion frontend
docker build -q -t anpr-motor:produccion services/anpr

TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT
P="$TRABAJO/$NOMBRE"
mkdir -p "$P/imagenes" "$P/scripts" "$P/mediamtx" "$P/frontend" "$P/codigo"

echo "2/5 Guardando las imágenes (varios minutos)..."
docker save -o "$P/imagenes/anpr_imagenes.tar" "${IMAGENES[@]}"

echo "3/5 Archivos de despliegue..."
# Contenido tal como está en el commit (saltos de línea LF, sin conversión de Windows)
desde_git() { git -c core.autocrlf=false cat-file blob "HEAD:$1" > "$2"; }
desde_git .env.example "$P/.env.example"
desde_git mediamtx/mediamtx.yml "$P/mediamtx/mediamtx.yml"
desde_git frontend/nginx.compose.conf "$P/frontend/nginx.compose.conf"
desde_git despliegue/instalar.sh "$P/scripts/instalar.sh"
desde_git despliegue/instalar.ps1 "$P/scripts/instalar.ps1"
chmod +x "$P/scripts/instalar.sh"
git -c core.autocrlf=false cat-file blob HEAD:despliegue/LEEME_DESPLIEGUE.txt \
  | sed "s|__VERSION__|commit $COMMIT del $FECHA (rama $(git rev-parse --abbrev-ref HEAD))|" > "$P/LEEME_DESPLIEGUE.txt"
# docker-compose.yml: el de producción sin las secciones de compilación y sin descargar las imágenes propias
git -c core.autocrlf=false cat-file blob HEAD:docker-compose.prod.yml | awk -v commit="$COMMIT" '
  BEGIN {
    print "# Sistema ANPR ECU 911 · despliegue de PRODUCCIÓN con imágenes ya compiladas (commit " commit ")."
    print "#"
    print "# Generado por despliegue/empaquetar.sh a partir de docker-compose.prod.yml, sin las secciones de"
    print "# compilación: las imágenes se cargan de imagenes/anpr_imagenes.tar (docker load) y no se descarga nada."
    print "# Instrucciones: LEEME_DESPLIEGUE.txt."
    print "#"
    print "#   docker compose up -d        (la primera vez, use scripts/instalar.sh o scripts/instalar.ps1)"
    cabecera = 1
  }
  cabecera && /^#/ { next }
  { cabecera = 0 }
  /^    build:/ { compilacion = 1; next }
  compilacion && /^      / { next }
  { compilacion = 0; print }
  /^    image: anpr-(backend|frontend|motor):produccion$/ { print "    pull_policy: never" }
' > "$P/docker-compose.yml"
if grep -q "build:" "$P/docker-compose.yml"; then echo "El compose del paquete aún tiene build:"; exit 1; fi
git -c core.autocrlf=false archive --format=zip -o "$P/codigo/NOVANPR_codigo_$COMMIT.zip" HEAD

echo "4/5 Huellas SHA-256..."
(cd "$P" && find . -type f ! -name SHA256SUMS.txt | sed 's|^\./||' | sort | xargs sha256sum -b > SHA256SUMS.txt)

echo "5/5 Comprimiendo..."
RAR="/c/Program Files/WinRAR/Rar.exe"
if [ -x "$RAR" ]; then
  ARCHIVO="$SALIDA/${NOMBRE}_$FECHA.rar"
  rm -f "$ARCHIVO"
  (cd "$TRABAJO" && "$RAR" a -r -m3 -idq "$(cygpath -w "$ARCHIVO" 2>/dev/null || echo "$ARCHIVO")" "$NOMBRE")
else
  ARCHIVO="$SALIDA/${NOMBRE}_$FECHA.tar.gz"
  tar czf "$ARCHIVO" -C "$TRABAJO" "$NOMBRE"
fi
echo
echo "Paquete: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1)), commit $COMMIT"
cat "$P/SHA256SUMS.txt"
