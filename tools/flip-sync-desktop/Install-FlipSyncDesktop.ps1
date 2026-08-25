$ErrorActionPreference = "Stop"

$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installDir = Join-Path $env:LOCALAPPDATA "Programs\FlipSyncDesktop"
$desktopDir = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopDir "Flip Sync Desktop.lnk"

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceDir "FlipSyncDesktop.ps1") -Destination $installDir -Force
Copy-Item -LiteralPath (Join-Path $sourceDir "FlipSyncDesktop.cmd") -Destination $installDir -Force

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $installDir "FlipSyncDesktop.cmd"
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,167"
$shortcut.Description = "Flip Sync Desktop"
$shortcut.Save()

Write-Host "Flip Sync Desktop instalado en: $installDir"
Write-Host "Acceso directo creado en: $shortcutPath"
