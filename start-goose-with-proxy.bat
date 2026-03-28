@echo off
echo ========================================
echo   Starting Goose with Token Tracker
echo ========================================
echo.
echo   NOTE: Make sure your Goose provider (StonerSuperComp)
echo   host URL is set to: http://localhost:3000
echo   (instead of http://192.168.0.8:8000)
echo.
echo   The Token Tracker proxy forwards all /v1/* requests
echo   to vLLM, tracking tokens along the way.
echo.
echo   Dashboard: http://localhost:3000/
echo.

set GOOSE_PATH=B:\Goose-win32-x64\dist-windows\goose.exe

if exist "%GOOSE_PATH%" (
    echo Starting Goose...
    start "" "%GOOSE_PATH%"
) else (
    echo Goose not found at: %GOOSE_PATH%
    echo Please update the GOOSE_PATH variable in this script.
    echo.
    pause
    exit /b 1
)

timeout /t 3 >nul
