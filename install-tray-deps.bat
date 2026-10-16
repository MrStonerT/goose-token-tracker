@echo off
echo Installing Goose Token Tracker tray dependencies...
pip install pystray pillow --quiet
echo.
echo Done! You can now run: pythonw tray.py
pause
