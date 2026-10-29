@echo off
REM ---------------------------------------------------------------
REM   EL CHUPE - Instalador para Windows
REM   Uso: doble clic en este archivo
REM ---------------------------------------------------------------
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   ============================================
echo     EL CHUPE  -  Instalacion del sistema POS
echo   ============================================
echo.

REM --- 1. Revisar Node.js -----------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   No encontre Node.js en este equipo.
  echo.
  echo   Instalalo primero desde:  https://nodejs.org
  echo   Descarga la version LTS, instala, cierra esta ventana
  echo   y vuelve a ejecutar este instalador.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
for /f "tokens=1 delims=." %%m in ("!NODEVER:v=!") do set NODEMAJOR=%%m
if !NODEMAJOR! LSS 22 (
  echo   Tienes Node.js !NODEVER! y se necesita la version 22 o superior.
  echo.
  echo   Entra a https://nodejs.org, descarga la version LTS,
  echo   instalala encima de la que tienes y reinicia el computador.
  echo.
  pause
  exit /b 1
)
echo   [1/4] Node.js !NODEVER! detectado.

REM --- 2. Crear el archivo .env -----------------------------------
if exist .env (
  echo   [2/4] Ya existe el archivo .env, lo dejo como esta.
) else (
  copy .env.example .env >nul
  for /f "tokens=*" %%s in ('node -e "console.log(require(''crypto'').randomBytes(48).toString(''hex''))"') do set SECRETO=%%s
  node -e "const fs=require('fs');let t=fs.readFileSync('.env','utf8');t=t.replace('cambia-esta-clave-por-una-larga-y-aleatoria',process.argv[1]);fs.writeFileSync('.env',t);" !SECRETO!
  echo   [2/4] Archivo .env creado con una clave de seguridad unica.
)

REM --- 3. Instalar dependencias -----------------------------------
echo   [3/4] Instalando componentes... ^(puede tardar 1 o 2 minutos^)
call npm install --omit=dev --omit=optional --no-audit --no-fund >install.log 2>&1
if errorlevel 1 (
  echo.
  echo   Fallo la instalacion de componentes.
  echo   ------------------------------------------------
  powershell -Command "Get-Content install.log -Tail 15"
  echo   ------------------------------------------------
  echo   El detalle completo quedo en el archivo install.log
  echo.
  pause
  exit /b 1
)

REM --- 4. Crear la base de datos ----------------------------------
if exist data\elchupe.db (
  echo   [4/4] La base de datos ya existe. No la toco para no borrar tus ventas.
) else (
  echo   [4/4] Creando la base de datos con los datos de arranque...
  call npm run setup
)

for /f "tokens=2 delims==" %%a in ('findstr /b "ADMIN_EMAIL=" .env') do set CORREO=%%a
for /f "tokens=2 delims==" %%a in ('findstr /b "ADMIN_PASSWORD=" .env') do set CLAVE=%%a
for /f "tokens=2 delims==" %%a in ('findstr /b "ADMIN_PIN=" .env') do set PIN=%%a
for /f "tokens=2 delims==" %%a in ('findstr /b "PORT=" .env') do set PUERTO=%%a

echo.
echo   ============================================
echo     Listo. El sistema quedo instalado.
echo   ============================================
echo.
echo     Para arrancarlo: doble clic en  iniciar.bat
echo.
echo     Luego abre el navegador en:  http://localhost:!PUERTO!
echo.
echo     Entra con:
echo       Correo:      !CORREO!
echo       Contrasena:  !CLAVE!
echo       PIN rapido:  !PIN!
echo.
echo     Cambia la contrasena apenas entres ^(Configuracion ^> Mi cuenta^).
echo.
pause
