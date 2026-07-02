@echo off
cd /d "%~dp0Tool"
where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py server.py
) else (
    python server.py
)
pause
