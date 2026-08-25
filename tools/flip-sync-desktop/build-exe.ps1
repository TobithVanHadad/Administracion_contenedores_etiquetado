$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $root "FlipSyncDesktop.ps1"
$dist = Join-Path $root "dist"
$launcherPath = Join-Path $dist "FlipSyncDesktopLauncher.cs"
$exePath = Join-Path $dist "FlipSyncDesktop.exe"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
  $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "No existe $scriptPath"
}

if (-not (Test-Path -LiteralPath $csc)) {
  throw "No encontre el compilador de Windows csc.exe. Usa FlipSyncDesktop.cmd como version portable."
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

$scriptBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($scriptPath))
$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
    private const string ScriptBase64 = "__SCRIPT_BASE64__";

    [STAThread]
    private static void Main()
    {
        try
        {
            string runtimeDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "FlipSyncDesktop",
                "runtime"
            );
            Directory.CreateDirectory(runtimeDir);

            string scriptPath = Path.Combine(runtimeDir, "FlipSyncDesktop.ps1");
            File.WriteAllBytes(scriptPath, Convert.FromBase64String(ScriptBase64));

            string powershellPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe"
            );
            if (!File.Exists(powershellPath))
            {
                powershellPath = "powershell.exe";
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = powershellPath,
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + scriptPath + "\"",
                UseShellExecute = false,
                CreateNoWindow = true
            };

            Process.Start(startInfo);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                ex.Message,
                "Flip Sync Desktop",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
'@.Replace("__SCRIPT_BASE64__", $scriptBase64)

Set-Content -LiteralPath $launcherPath -Value $source -Encoding UTF8
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /out:$exePath /reference:System.Windows.Forms.dll $launcherPath
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo compilar FlipSyncDesktop.exe"
}

if (-not (Test-Path -LiteralPath $exePath)) {
  throw "No se genero $exePath"
}

Get-Item -LiteralPath $exePath | Select-Object FullName, Length, LastWriteTime
