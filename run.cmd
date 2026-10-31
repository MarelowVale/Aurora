@echo off
setlocal
cd /d "%~dp0"

set "EXE=bin\Release\net10.0-windows\Aurora.exe"
if exist "%EXE%" goto run

echo Building Aurora...
dotnet build -c Release --nologo -v m
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

:run
start "" "%EXE%"
exit /b 0
