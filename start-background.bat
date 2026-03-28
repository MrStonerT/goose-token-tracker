@echo off
cd /d "%~dp0"
echo Starting Goose Token Tracker in background...
start "GooseTokenTracker" /min cmd /c "node server.js"
echo.
echo   Tracker is running in a minimized window.
echo   Dashboard: http://localhost:3000/
echo   To stop: close the "GooseTokenTracker" window from the taskbar
echo.
timeout /t 3 >nul
