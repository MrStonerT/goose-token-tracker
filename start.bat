@echo off
title Goose Token Tracker
cd /d "%~dp0"
echo Starting Goose Token Tracker...
echo.
echo   Dashboard: http://localhost:4747/
echo   Press Ctrl+C to stop
echo.
node server.js
pause
