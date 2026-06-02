$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 3010
$HealthUrl = "http://127.0.0.1:$Port/api/orders"
$NodePath = "C:\Program Files\nodejs\node.exe"
$LogDir = Join-Path $ProjectDir "logs"
$OutLog = Join-Path $LogDir "next-dev.out.log"
$ErrLog = Join-Path $LogDir "next-dev.err.log"

function Test-OrvelApp {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 8
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-OrvelApp) {
  Write-Host "OK: la app ya esta funcionando en http://127.0.0.1:$Port"
  Write-Host "URL publica: https://distribucionesorvelcontenedores.cristobalcarrilloproyectsbykimvandera.com"
  exit 0
}

if (-not (Test-Path -LiteralPath $NodePath)) {
  Write-Host "No encontre Node.js en: $NodePath"
  Write-Host "Instala Node.js o revisa que la ruta exista."
  exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Start-Process `
  -FilePath $NodePath `
  -ArgumentList ".\node_modules\next\dist\bin\next", "dev", "-p", "$Port", "-H", "0.0.0.0" `
  -WorkingDirectory $ProjectDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog

Write-Host "Levantando app local en el puerto $Port..."
Start-Sleep -Seconds 12

if (Test-OrvelApp) {
  Write-Host "OK: app local funcionando."
  Write-Host "Abre: http://127.0.0.1:$Port"
  Write-Host "Publica: https://distribucionesorvelcontenedores.cristobalcarrilloproyectsbykimvandera.com"
  exit 0
}

Write-Host "No arranco la app. Revisa este archivo:"
Write-Host $ErrLog
exit 1
