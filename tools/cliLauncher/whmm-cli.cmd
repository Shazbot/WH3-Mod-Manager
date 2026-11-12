@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0wh3mm.exe" "%~dp0resources\headless\cli\main.js" %*
exit /b %ERRORLEVEL%
