@echo off
cd /d "%~dp0"
echo.
echo   Arrancando EL CHUPE POS...
echo   Deja esta ventana abierta mientras uses el sistema.
echo.
start "" http://localhost:3000
call npm start
pause
