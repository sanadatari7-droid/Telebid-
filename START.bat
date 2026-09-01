@echo off
title TeleBid Enterprise
color 0B
echo.
echo  ============================================
echo   TeleBid Enterprise - Starting...
echo  ============================================
echo.

:: Check Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  ERROR: Docker is not running.
    echo  Please open Docker Desktop and wait for it to start,
    echo  then double-click this file again.
    echo.
    pause
    exit /b 1
)

echo  Docker is running. Starting TeleBid...
echo.

:: First run: build everything. Subsequent runs: just start.
docker compose up --build -d

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  ERROR: Failed to start. Check the error above.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo   TeleBid Enterprise is RUNNING
echo  ============================================
echo.
echo  Opening browser...
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo  Login:    admin / Admin@1234
echo.
echo  To STOP:  double-click STOP.bat
echo  Or press any key to stop now.
echo.
pause
docker compose down
