#!/bin/bash
clear
echo ""
echo "  ============================================"
echo "   TeleBid Enterprise - Starting..."
echo "  ============================================"
echo ""

# Check Docker
if ! docker info > /dev/null 2>&1; then
    echo "  ERROR: Docker is not running."
    echo "  Please open Docker Desktop and wait for it to start,"
    echo "  then run this script again."
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
fi

echo "  Docker is running. Starting TeleBid..."
echo ""

# Start in background
docker compose up --build -d

if [ $? -ne 0 ]; then
    echo ""
    echo "  ERROR: Failed to start. See error above."
    read -p "  Press Enter to exit..."
    exit 1
fi

echo ""
echo "  ============================================"
echo "   TeleBid Enterprise is RUNNING"
echo "  ============================================"
echo ""
echo "  URL:    http://localhost:5173"
echo "  Login:  admin / Admin@1234"
echo ""

# Open browser
sleep 3
if command -v xdg-open > /dev/null; then
    xdg-open http://localhost:5173        # Linux
elif command -v open > /dev/null; then
    open http://localhost:5173            # Mac
fi

echo "  To stop:  ./stop.sh"
echo "  To reset: ./reset.sh"
echo ""
