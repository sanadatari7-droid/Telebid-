@echo off
title TeleBid Enterprise - Reset
color 0C
echo.
echo  WARNING: This will DELETE all your data and start fresh.
echo.
set /p confirm="Type YES to confirm reset: "
if /i "%confirm%" neq "YES" (
    echo  Cancelled.
    pause
    exit /b
)
echo.
echo  Resetting TeleBid Enterprise...
docker compose down -v
docker compose up --build -d
timeout /t 3 /nobreak >nul
start http://localhost:5173
echo.
echo  Reset complete. Login: admin / Admin@1234
pause
