Set WshShell = CreateObject("WScript.Shell")
' Update this path to your goose-token-tracker installation
WshShell.CurrentDirectory = "C:\path\to\goose-token-tracker"
WshShell.Run "cmd /c node server.js > data\server.log 2>&1", 0, False
