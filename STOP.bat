@echo off
title TeleBid Enterprise - Stopping
color 0E
echo.
echo  Stopping TeleBid Enterprise...
docker compose down
echo.
echo  TeleBid has been stopped.
echo.
pause
