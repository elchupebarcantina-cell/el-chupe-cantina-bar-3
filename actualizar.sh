#!/usr/bin/env bash
# ---------------------------------------------------------------
#  EL CHUPE - Actualizar conservando ventas, logo y configuracion
#  Uso:  bash actualizar.sh /ruta/de/la/instalacion/anterior
# ---------------------------------------------------------------
set -e
cd "$(dirname "$0")"

ORO='\033[38;5;179m'; VERDE='\033[0;32m'; ROJO='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${ORO}  ============================================${NC}"
echo -e "${ORO}    EL CHUPE  ·  Actualizar instalacion${NC}"
echo -e "${ORO}  ============================================${NC}"
echo ""

VIEJA="$1"
if [ -z "$VIEJA" ]; then
  echo "  Cierra primero el sistema si esta corriendo."
  echo ""
  read -p "  Ruta de la carpeta anterior: " VIEJA
fi
VIEJA="${VIEJA%\"}"; VIEJA="${VIEJA#\"}"

if [ ! -f "$VIEJA/data/elchupe.db" ]; then
  echo -e "${ROJO}  No encontre una base de datos en $VIEJA/data/elchupe.db${NC}"
  echo "  Verifica que sea la carpeta correcta de la instalacion anterior."
  echo ""
  exit 1
fi

echo -e "  ${VERDE}[1/4]${NC} Copiando la base de datos con tus ventas…"
mkdir -p data
cp "$VIEJA/data/elchupe.db" data/elchupe.db
cp "$VIEJA/data/elchupe.db-wal" data/ 2>/dev/null || true
cp "$VIEJA/data/elchupe.db-shm" data/ 2>/dev/null || true

echo -e "  ${VERDE}[2/4]${NC} Copiando tu configuracion…"
[ -f "$VIEJA/.env" ] && cp "$VIEJA/.env" .env || true

echo -e "  ${VERDE}[3/4]${NC} Copiando tu logo y las imagenes…"
if [ -d "$VIEJA/public/uploads" ]; then
  mkdir -p public/uploads
  cp -R "$VIEJA/public/uploads/." public/uploads/
fi

echo -e "  ${VERDE}[4/4]${NC} Guardando respaldo de la base anterior…"
mkdir -p backups
cp "$VIEJA/data/elchupe.db" backups/antes-de-actualizar.db

echo ""
echo -e "${ORO}  ============================================${NC}"
echo -e "${VERDE}    Listo. Tus datos quedaron en esta carpeta.${NC}"
echo -e "${ORO}  ============================================${NC}"
echo ""
echo "    Ahora ejecuta:  bash instalar.sh   y luego  bash iniciar.sh"
echo ""
echo "    En el navegador presiona Ctrl + Shift + R (Mac: Cmd + Shift + R)."
echo ""
echo "    Respaldo de tu base anterior en: backups/antes-de-actualizar.db"
echo ""
