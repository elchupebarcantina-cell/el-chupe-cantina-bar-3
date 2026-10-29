@echo off
REM ---------------------------------------------------------------
REM   EL CHUPE - Actualizar conservando ventas, logo y configuracion
REM   Uso: doble clic. Te pide la carpeta de la instalacion anterior.
REM ---------------------------------------------------------------
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo   ============================================
echo     EL CHUPE  -  Actualizar instalacion
echo   ============================================
echo.
echo   Este asistente trae tus ventas, tu logo y tu configuracion
echo   desde la instalacion anterior a esta carpeta nueva.
echo.
echo   IMPORTANTE: cierra primero la ventana negra donde corre el
echo   sistema. Si sigue abierta, no se puede copiar la base de datos.
echo.
set /p VIEJA=  Arrastra aqui la carpeta anterior y presiona Enter: 

REM Quitar comillas si las trae
set VIEJA=%VIEJA:"=%

if not exist "%VIEJA%" (
  echo.
  echo   No encontre esa carpeta. Revisa la ruta y vuelve a intentar.
  echo.
  pause
  exit /b 1
)

if not exist "%VIEJA%\data\elchupe.db" (
  echo.
  echo   En esa carpeta no hay una base de datos ^(data\elchupe.db^).
  echo   Verifica que sea la carpeta correcta de la instalacion anterior.
  echo.
  pause
  exit /b 1
)

echo.
echo   [1/4] Copiando la base de datos con tus ventas...
if not exist data mkdir data
copy /Y "%VIEJA%\data\elchupe.db" "data\elchupe.db" >nul
if exist "%VIEJA%\data\elchupe.db-wal" copy /Y "%VIEJA%\data\elchupe.db-wal" "data\" >nul 2>&1
if exist "%VIEJA%\data\elchupe.db-shm" copy /Y "%VIEJA%\data\elchupe.db-shm" "data\" >nul 2>&1

echo   [2/4] Copiando tu configuracion...
if exist "%VIEJA%\.env" copy /Y "%VIEJA%\.env" ".env" >nul

echo   [3/4] Copiando tu logo y las imagenes...
if exist "%VIEJA%\public\uploads" xcopy /E /I /Y /Q "%VIEJA%\public\uploads" "public\uploads" >nul

echo   [4/4] Guardando una copia de respaldo de la base anterior...
if not exist backups mkdir backups
copy /Y "%VIEJA%\data\elchupe.db" "backups\antes-de-actualizar.db" >nul

echo.
echo   ============================================
echo     Listo. Tus datos quedaron en esta carpeta.
echo   ============================================
echo.
echo     Ahora ejecuta  instalar.bat  y despues  iniciar.bat
echo.
echo     Cuando abras el navegador, presiona Ctrl + Shift + R
echo     para que cargue la version nueva de la pantalla.
echo.
echo     Por si acaso, guarde una copia de tu base anterior en:
echo       backups\antes-de-actualizar.db
echo.
pause
