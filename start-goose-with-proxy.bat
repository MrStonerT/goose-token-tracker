@echo off
echo ========================================
echo   Starting Goose with Token Tracker
echo ========================================
echo.
echo   NOTE: Make sure your Goose provider's
echo   host URL is set to: http://localhost:3000
echo   (instead of your vLLM server directly)
echo.
echo   The Token Tracker proxy forwards all /v1/* requests
echo   to vLLM, tracking tokens along the way.
echo.
echo   Dashboard: http://localhost:3000/
echo.

REM Update this path to your Goose installation
set GOOSE_PATH=C:\path\to\goose.exe

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
