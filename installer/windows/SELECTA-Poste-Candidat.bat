@echo off
:: =====================================================================
::  SELECTA - Poste candidat verrouille (mode kiosque)
::  - plein ecran sans barre d'adresse ni onglets (toute sortie de la
::    fenetre est detectee et signalee par la surveillance)
::  - camera autorisee sur le reseau local meme sans HTTPS
::  - profil navigateur jetable : aucun historique, aucune extension
::  Modifiez SERVER ci-dessous (ou le fichier serveur.txt) avec l'adresse
::  du serveur SELECTA de la salle.
:: =====================================================================
setlocal
set SERVER=http://192.168.1.10:8069
if exist "%~dp0serveur.txt" set /p SERVER=<"%~dp0serveur.txt"
set PROFILE=%TEMP%\selecta-kiosk-%RANDOM%

set BROWSER=
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set BROWSER="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set BROWSER="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set BROWSER="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER (
    echo Aucun navigateur Chrome ou Edge trouve sur ce poste.
    pause
    exit /b 1
)

start "" %BROWSER% --kiosk "%SERVER%/selecta/exam" ^
  --user-data-dir="%PROFILE%" ^
  --unsafely-treat-insecure-origin-as-secure=%SERVER% ^
  --use-fake-ui-for-media-stream ^
  --no-first-run --no-default-browser-check --disable-extensions ^
  --disable-translate --disable-features=Translate,TranslateUI ^
  --disable-pinch --overscroll-history-navigation=0 ^
  --incognito
endlocal
