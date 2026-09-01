#!/bin/bash
echo ""
echo "  WARNING: This will DELETE all your data and start fresh."
echo ""
read -p "  Type YES to confirm: " confirm
if [ "$confirm" != "YES" ]; then
    echo "  Cancelled."
    exit 0
fi
echo ""
echo "  Resetting..."
docker compose down -v
docker compose up --build -d
sleep 3
if command -v xdg-open > /dev/null; then xdg-open http://localhost:5173
elif command -v open > /dev/null; then open http://localhost:5173
fi
echo ""
echo "  Reset complete. Login: admin / Admin@1234"
echo ""
