$ErrorActionPreference = "Stop"

$root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$logDir = Join-Path $root "data"
$logFile = Join-Path $logDir "dev-server.log"
$errFile = Join-Path $logDir "dev-server.err"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location -LiteralPath $root

"[$(Get-Date -Format s)] Starting Next dev server on port 3010" | Out-File -FilePath $logFile -Encoding utf8 -Append
& "C:\Program Files\nodejs\node.exe" ".\node_modules\next\dist\bin\next" dev -p 3010 -H 0.0.0.0 1>> $logFile 2>> $errFile
