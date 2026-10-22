@echo off
:: SELECTA - lance l'installateur PowerShell avec les droits administrateur
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Elevation des privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-SELECTA.ps1" %*
pause
