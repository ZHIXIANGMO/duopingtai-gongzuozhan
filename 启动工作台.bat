@echo off
cd /d "%~dp0"
echo.
echo   Content Matrix Console - starting local server
echo   http://127.0.0.1:8777
echo   Close this window to stop the server.
echo.
python "%~dp0serve.py"
if errorlevel 1 py "%~dp0serve.py"
echo.
echo   Not started. Python is probably not installed.
pause
