#!/usr/bin/env bash
cd "$(dirname "$0")"
echo ""
echo "  Arrancando EL CHUPE POS..."
echo "  Deja esta ventana abierta mientras uses el sistema."
echo ""
(sleep 2 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null)) &
npm start
