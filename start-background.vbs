Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "B:\Pond\GooseGooseGo\Goose-TokenTracker"
WshShell.Run "cmd /c node server.js > data\server.log 2>&1", 0, False
