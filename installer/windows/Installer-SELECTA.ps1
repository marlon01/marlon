<#
  SELECTA — installation du serveur de concours sur Windows 10/11 (64 bits)
  -----------------------------------------------------------------------
  Exécuter en administrateur :
      clic droit sur « Installer-SELECTA.bat » > Exécuter en tant qu'administrateur
  ou dans PowerShell (administrateur) :
      Set-ExecutionPolicy -Scope Process Bypass -Force; .\Installer-SELECTA.ps1

  Installation 100 % hors ligne possible : placez le fichier odoo_18.0.latest.exe
  dans ce même dossier avant de lancer le script (sinon il est téléchargé).
#>
param(
    [string]$Database = "selecta",
    [string]$AdminPassword = "",
    [int]$Port = 8069,
    [switch]$WithDemo
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $Here "..\..")
$AddonsSrc = Join-Path $Root "addons\selecta_concours"
$SelectaHome = "C:\SELECTA"
$AddonsDst = Join-Path $SelectaHome "addons"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être exécuté en tant qu'administrateur."
}
if (-not (Test-Path $AddonsSrc)) { throw "Module introuvable : $AddonsSrc" }

# ---------------------------------------------------------------- 1. Odoo 18 Community
Step "Recherche d'Odoo 18"
$OdooDir = Get-ChildItem "C:\Program Files" -Directory -Filter "Odoo 18*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $OdooDir) {
    $Installer = Get-ChildItem $Here -Filter "odoo_18*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Installer) {
        Step "Téléchargement d'Odoo 18 Community (environ 600 Mo)"
        $Installer = Join-Path $env:TEMP "odoo_18.0.latest.exe"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest "https://nightly.odoo.com/18.0/nightly/windows/odoo_18.0.latest.exe" -OutFile $Installer -UseBasicParsing
        $Installer = Get-Item $Installer
    }
    Step "Installation silencieuse d'Odoo 18 et de PostgreSQL"
    Start-Process -FilePath $Installer.FullName -ArgumentList "/S" -Wait
    $OdooDir = Get-ChildItem "C:\Program Files" -Directory -Filter "Odoo 18*" | Select-Object -First 1
    if (-not $OdooDir) { throw "L'installation d'Odoo a échoué." }
}
Ok "Odoo : $($OdooDir.FullName)"
$Python = Join-Path $OdooDir.FullName "python\python.exe"
$OdooBin = Join-Path $OdooDir.FullName "server\odoo-bin"
$Conf = Join-Path $OdooDir.FullName "server\odoo.conf"

# ---------------------------------------------------------------- 2. Module SELECTA
Step "Copie du module SELECTA"
New-Item -ItemType Directory -Force -Path $AddonsDst | Out-Null
if (Test-Path (Join-Path $AddonsDst "selecta_concours")) { Remove-Item -Recurse -Force (Join-Path $AddonsDst "selecta_concours") }
Copy-Item -Recurse $AddonsSrc $AddonsDst
Ok "Module copié dans $AddonsDst"

# ---------------------------------------------------------------- 3. Configuration
Step "Configuration du serveur"
if (-not $AdminPassword) {
    $AdminPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
}
$lines = Get-Content $Conf
$set = @{
    "addons_path" = "$($OdooDir.FullName)\server\odoo\addons,$AddonsDst"
    "admin_passwd" = $AdminPassword
    "http_port" = "$Port"
    "dbfilter" = "^$Database$"
    "list_db" = "False"
    "proxy_mode" = "False"
    "limit_time_real" = "600"
}
foreach ($k in $set.Keys) {
    $found = $false
    $lines = $lines | ForEach-Object { if ($_ -match "^\s*$k\s*=") { $found = $true; "$k = $($set[$k])" } else { $_ } }
    if (-not $found) { $lines += "$k = $($set[$k])" }
}
Set-Content -Path $Conf -Value $lines -Encoding UTF8
Ok "odoo.conf mis à jour (gestionnaire de bases désactivé, filtre sur « $Database »)"

# ---------------------------------------------------------------- 4. Base de données
Step "Création de la base « $Database » et installation de SELECTA"
$svc = Get-Service | Where-Object { $_.Name -like "odoo-server-18*" } | Select-Object -First 1
if ($svc) { Stop-Service $svc.Name -Force; Start-Sleep 3 }
$demo = if ($WithDemo) { "" } else { "--without-demo=all" }
& $Python $OdooBin -c $Conf -d $Database -i selecta_concours $demo --stop-after-init --load-language=fr_FR
if ($LASTEXITCODE -ne 0) { throw "L'initialisation de la base a échoué." }
if ($svc) { Start-Service $svc.Name }
Ok "Base prête"

# ---------------------------------------------------------------- 5. Réseau local
Step "Ouverture du port $Port sur le pare-feu (réseau privé uniquement)"
if (-not (Get-NetFirewallRule -DisplayName "SELECTA $Port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "SELECTA $Port" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null
}
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1).IPAddress

# ---------------------------------------------------------------- 6. Raccourcis
Step "Création des raccourcis"
Copy-Item (Join-Path $Here "SELECTA-Console.bat") $SelectaHome -Force
Copy-Item (Join-Path $Here "SELECTA-Poste-Candidat.bat") $SelectaHome -Force
$desk = [Environment]::GetFolderPath("CommonDesktopDirectory")
$wsh = New-Object -ComObject WScript.Shell
foreach ($n in @("SELECTA-Console", "SELECTA-Poste-Candidat")) {
    $lnk = $wsh.CreateShortcut((Join-Path $desk "$n.lnk"))
    $lnk.TargetPath = Join-Path $SelectaHome "$n.bat"
    $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,47"
    $lnk.Save()
}
Set-Content -Path (Join-Path $SelectaHome "serveur.txt") -Value "http://$($ip):$Port"

Write-Host "`n================================================================" -ForegroundColor Green
Write-Host " SELECTA est installé." -ForegroundColor Green
Write-Host " Console du personnel : http://localhost:$Port/selecta/login"
Write-Host " Espace candidat (LAN) : http://$($ip):$Port/selecta/exam"
Write-Host " Identifiant initial   : admin / admin  (à changer immédiatement)"
Write-Host " Mot de passe maître   : $AdminPassword  (conservez-le en lieu sûr)"
Write-Host "================================================================`n" -ForegroundColor Green
Set-Content -Path (Join-Path $SelectaHome "IMPORTANT-mot-de-passe-maitre.txt") -Value "Mot de passe maître Odoo : $AdminPassword"
