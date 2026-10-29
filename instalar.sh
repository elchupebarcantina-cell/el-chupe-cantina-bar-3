#!/usr/bin/env bash
# ---------------------------------------------------------------
#  EL CHUPE - Instalador para Mac y Linux
#  Uso:  bash instalar.sh
# ---------------------------------------------------------------
set -e
cd "$(dirname "$0")"

ORO='\033[38;5;179m'; VERDE='\033[0;32m'; ROJO='\033[0;31m'; GRIS='\033[0;90m'; NC='\033[0m'

echo ""
echo -e "${ORO}  ============================================${NC}"
echo -e "${ORO}    EL CHUPE  ·  Instalacion del sistema POS${NC}"
echo -e "${ORO}  ============================================${NC}"
echo ""

# --- 1. Revisar Node.js -----------------------------------------
if ! command -v node > /dev/null 2>&1; then
  echo -e "${ROJO}  No encontre Node.js en este equipo.${NC}"
  echo ""
  echo "  Instalalo primero desde:  https://nodejs.org"
  echo "  Descarga la version LTS, instala, cierra esta ventana"
  echo "  y vuelve a ejecutar este instalador."
  echo ""
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo -e "${ROJO}  Tienes Node.js $(node -v) y se necesita la version 22 o superior.${NC}"
  echo "  Actualizalo desde https://nodejs.org y vuelve a intentar."
  echo ""
  exit 1
fi
echo -e "  ${VERDE}[1/4]${NC} Node.js $(node -v) detectado."

# --- 2. Crear el archivo .env -----------------------------------
if [ -f .env ]; then
  echo -e "  ${VERDE}[2/4]${NC} Ya existe el archivo .env, lo dejo como esta."
else
  cp .env.example .env
  SECRETO=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  # Reemplazo compatible con Mac y Linux
  node -e "
    const fs=require('fs');
    let t=fs.readFileSync('.env','utf8');
    t=t.replace('cambia-esta-clave-por-una-larga-y-aleatoria','$SECRETO');
    fs.writeFileSync('.env',t);
  "
  echo -e "  ${VERDE}[2/4]${NC} Archivo .env creado con una clave de seguridad unica."
fi

# --- 3. Instalar dependencias -----------------------------------
echo -e "  ${VERDE}[3/4]${NC} Instalando componentes… (puede tardar 1 o 2 minutos)"
npm install --omit=dev --omit=optional --no-audit --no-fund > /tmp/elchupe-install.log 2>&1 || {
  echo -e "${ROJO}  Fallo la instalacion de componentes.${NC}"
  echo "  Detalle del error:"
  tail -20 /tmp/elchupe-install.log
  exit 1
}

# --- 4. Crear la base de datos ----------------------------------
if [ -f data/elchupe.db ]; then
  echo -e "  ${VERDE}[4/4]${NC} La base de datos ya existe. No la toco para no borrar tus ventas."
else
  echo -e "  ${VERDE}[4/4]${NC} Creando la base de datos con los datos de arranque…"
  npm run setup
fi

CLAVE=$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)
CORREO=$(grep '^ADMIN_EMAIL=' .env | cut -d= -f2-)
PIN=$(grep '^ADMIN_PIN=' .env | cut -d= -f2-)
PUERTO=$(grep '^PORT=' .env | cut -d= -f2-)

echo ""
echo -e "${ORO}  ============================================${NC}"
echo -e "${VERDE}    Listo. El sistema quedo instalado.${NC}"
echo -e "${ORO}  ============================================${NC}"
echo ""
echo "    Para arrancarlo escribe:   npm start"
echo ""
echo -e "    Luego abre el navegador en:  ${ORO}http://localhost:${PUERTO}${NC}"
echo ""
echo "    Entra con:"
echo "      Correo:      $CORREO"
echo "      Contrasena:  $CLAVE"
echo "      PIN rapido:  $PIN"
echo ""
echo -e "${GRIS}    Cambia la contrasena apenas entres (Configuracion > Mi cuenta).${NC}"
echo ""
