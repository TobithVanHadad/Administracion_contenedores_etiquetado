Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

[System.Windows.Forms.Application]::EnableVisualStyles()

$ErrorActionPreference = "Stop"
$script:AllowedExtensions = @(".nlbl", ".btw", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf")
$script:Users = @("Gloria", "Cala", "Cristobal", "compras", "almacen")
$script:MaxBatchFiles = 8
$script:MaxBatchBytes = 6MB
$script:Orders = @()
$script:ConfigDir = Join-Path $env:APPDATA "FlipSyncDesktop"
$script:ConfigPath = Join-Path $script:ConfigDir "config.json"

function New-DefaultConfig {
  [PSCustomObject]@{
    serverUrl = "https://administracioncontenedoresetiquetado-production.up.railway.app"
    user = "Gloria"
    pin = ""
    overwriteExisting = $false
    intervalMinutes = 30
    excelPath = Join-Path $env:USERPROFILE "Desktop\OneDrive - Crevel Europe GmbH\Operations Mexico\Operations Mexico\Contenedores Orvel Europa.xlsx"
    syncExcelEnabled = $true
    defaultCustomer = "CREVEL"
    defaultOwner = "Operaciones MX"
    defaultDestination = "mexico"
    defaultPriority = "media"
    defaultDispatchDate = (Get-Date -Format "yyyy-MM-dd")
    excludedSheets = "MASTER,BODEGA,DV,CAT"
    removeMissingLines = $false
    lastExcelFingerprint = ""
    orderFolders = [PSCustomObject]@{}
  }
}

function Load-Config {
  if (Test-Path -LiteralPath $script:ConfigPath) {
    try {
      return Get-Content -LiteralPath $script:ConfigPath -Raw | ConvertFrom-Json
    } catch {
      return New-DefaultConfig
    }
  }

  return New-DefaultConfig
}

function Get-ConfigText {
  param(
    [string]$Name,
    [string]$Fallback = ""
  )

  $property = $script:Config.PSObject.Properties[$Name]
  if ($property -and $null -ne $property.Value -and [string]$property.Value) {
    return [string]$property.Value
  }

  return $Fallback
}

function Get-ConfigBool {
  param(
    [string]$Name,
    [bool]$Fallback = $false
  )

  $property = $script:Config.PSObject.Properties[$Name]
  if ($property -and $null -ne $property.Value) {
    return [bool]$property.Value
  }

  return $Fallback
}

function Get-ConfigFolder {
  param([string]$OrderId)
  if (-not $script:Config.orderFolders) { return "" }
  $property = $script:Config.orderFolders.PSObject.Properties[$OrderId]
  if ($property) { return [string]$property.Value }
  return ""
}

function Save-ConfigFromUi {
  New-Item -ItemType Directory -Force -Path $script:ConfigDir | Out-Null
  $folders = [ordered]@{}
  foreach ($row in $grid.Rows) {
    if ($row.IsNewRow) { continue }
    $orderId = [string]$row.Cells["OrderId"].Value
    $folder = [string]$row.Cells["Folder"].Value
    if ($orderId -and $folder.Trim()) {
      $folders[$orderId] = $folder.Trim()
    }
  }

  $config = [ordered]@{
    serverUrl = $txtServer.Text.Trim()
    user = $txtUser.Text.Trim()
    pin = $txtPin.Text
    overwriteExisting = [bool]$chkOverwrite.Checked
    intervalMinutes = [int]$numInterval.Value
    excelPath = $txtExcelPath.Text.Trim()
    syncExcelEnabled = [bool]$chkAutoExcel.Checked
    defaultCustomer = $txtDefaultCustomer.Text.Trim()
    defaultOwner = $txtDefaultOwner.Text.Trim()
    defaultDestination = $cmbDefaultDestination.Text.Trim()
    defaultPriority = $cmbDefaultPriority.Text.Trim()
    defaultDispatchDate = $txtDefaultDispatch.Text.Trim()
    excludedSheets = $txtExcludedSheets.Text.Trim()
    removeMissingLines = [bool]$chkRemoveMissing.Checked
    lastExcelFingerprint = [string]$script:LastExcelFingerprint
    orderFolders = $folders
  }

  $config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
  $script:Config = Load-Config
  $script:LastExcelFingerprint = Get-ConfigText -Name "lastExcelFingerprint"
  Write-Log "Configuracion guardada en $script:ConfigPath"
}

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  $txtLog.AppendText($line + [Environment]::NewLine)
  $txtLog.SelectionStart = $txtLog.TextLength
  $txtLog.ScrollToCaret()
  [System.Windows.Forms.Application]::DoEvents()
}

function Base-Url {
  $server = $txtServer.Text.Trim()
  if ($server.EndsWith("/")) { return $server.TrimEnd("/") }
  return $server
}

function Invoke-FlipJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $uri = (Base-Url) + $Path
  if ($Body -eq $null) {
    return Invoke-RestMethod -Uri $uri -Method $Method -TimeoutSec 120
  }

  $json = $Body | ConvertTo-Json -Depth 20
  return Invoke-RestMethod -Uri $uri -Method $Method -ContentType "application/json" -Body $json -TimeoutSec 120
}

function Load-Orders {
  Write-Log "Leyendo pedidos desde Flip..."
  $data = Invoke-FlipJson -Method "GET" -Path "/api/orders"
  $script:Orders = @($data.orders)
  $grid.Rows.Clear()

  foreach ($order in $script:Orders) {
    $folder = ""
    if ($order.labelFolderPath) { $folder = [string]$order.labelFolderPath }
    if (-not $folder) { $folder = Get-ConfigFolder -OrderId ([string]$order.id) }

    $index = $grid.Rows.Add()
    $grid.Rows[$index].Cells["OrderId"].Value = [string]$order.id
    $grid.Rows[$index].Cells["Code"].Value = [string]$order.code
    $grid.Rows[$index].Cells["Customer"].Value = [string]$order.customer
    $grid.Rows[$index].Cells["Folder"].Value = $folder
    $grid.Rows[$index].Cells["Files"].Value = ""
    $grid.Rows[$index].Cells["Status"].Value = "Listo"
  }

  Write-Log ("Pedidos cargados: {0}" -f $script:Orders.Count)
}

function Get-SelectedGridRow {
  if ($grid.SelectedRows.Count -gt 0) { return $grid.SelectedRows[0] }
  if ($grid.CurrentRow -and -not $grid.CurrentRow.IsNewRow) { return $grid.CurrentRow }
  return $null
}

function Find-OrderById {
  param([string]$OrderId)
  foreach ($order in $script:Orders) {
    if ([string]$order.id -eq $OrderId) { return $order }
  }
  return $null
}

function Save-FolderToFlip {
  param(
    [System.Windows.Forms.DataGridViewRow]$Row,
    [bool]$Quiet = $false
  )

  $orderId = [string]$Row.Cells["OrderId"].Value
  $code = [string]$Row.Cells["Code"].Value
  $folder = ([string]$Row.Cells["Folder"].Value).Trim()
  if (-not $orderId) { return }

  $auth = @{
    orderId = $orderId
    user = $txtUser.Text.Trim()
    pin = $txtPin.Text
  }

  Invoke-FlipJson -Method "PATCH" -Path "/api/orders" -Body ($auth + @{
    type = "updateField"
    field = "labelFolderPath"
    value = $folder
    label = $(if ($folder) { "Carpeta de etiquetas asignada desde Flip Sync Desktop: $folder." } else { "Carpeta de etiquetas eliminada desde Flip Sync Desktop." })
  }) | Out-Null

  Invoke-FlipJson -Method "PATCH" -Path "/api/orders" -Body ($auth + @{
    type = "updateField"
    field = "labelFolderUpdatedAt"
    value = (Get-Date).ToUniversalTime().ToString("o")
    label = "Fecha de carpeta de etiquetas actualizada desde Flip Sync Desktop."
  }) | Out-Null

  if (-not $Quiet) { Write-Log "Carpeta guardada en Flip para $code" }
}

function Get-AllowedFiles {
  param([string]$FolderPath)
  if (-not (Test-Path -LiteralPath $FolderPath -PathType Container)) {
    throw "La carpeta no existe: $FolderPath"
  }

  Get-ChildItem -LiteralPath $FolderPath -Recurse -File |
    Where-Object { $script:AllowedExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object FullName
}

function Get-RelativePath {
  param(
    [string]$FolderPath,
    [string]$FilePath
  )

  $base = [System.IO.Path]::GetFullPath($FolderPath)
  if (-not $base.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $base += [System.IO.Path]::DirectorySeparatorChar
  }
  $target = [System.IO.Path]::GetFullPath($FilePath)
  $baseUri = [Uri]$base
  $targetUri = [Uri]$target
  return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace("/", "\")
}

function Split-Batches {
  param([object[]]$Files)
  $batches = @()
  $current = New-Object System.Collections.ArrayList
  $currentSize = 0L

  foreach ($file in $Files) {
    $wouldOverflow = $current.Count -gt 0 -and ($current.Count -ge $script:MaxBatchFiles -or ($currentSize + $file.Length) -gt $script:MaxBatchBytes)
    if ($wouldOverflow) {
      $batches += ,@($current)
      $current = New-Object System.Collections.ArrayList
      $currentSize = 0L
    }

    [void]$current.Add($file)
    $currentSize += $file.Length
  }

  if ($current.Count -gt 0) { $batches += ,@($current) }
  return $batches
}

function Get-MimeType {
  param([string]$FilePath)
  switch ([System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()) {
    ".pdf" { return "application/pdf" }
    ".png" { return "image/png" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".webp" { return "image/webp" }
    ".gif" { return "image/gif" }
    default { return "application/octet-stream" }
  }
}

function Upload-Batch {
  param(
    [object]$Order,
    [string]$FolderPath,
    [object[]]$Batch
  )

  $client = New-Object System.Net.Http.HttpClient
  $form = New-Object System.Net.Http.MultipartFormDataContent
  $streams = New-Object System.Collections.ArrayList

  try {
    $form.Add((New-Object System.Net.Http.StringContent([string]$Order.id)), "orderId")
    $form.Add((New-Object System.Net.Http.StringContent($txtUser.Text.Trim())), "user")
    $form.Add((New-Object System.Net.Http.StringContent($txtPin.Text)), "pin")
    $form.Add((New-Object System.Net.Http.StringContent($(if ($chkOverwrite.Checked) { "1" } else { "0" }))), "overwriteExisting")

    $metadata = @()
    foreach ($file in $Batch) {
      $relativePath = Get-RelativePath -FolderPath $FolderPath -FilePath $file.FullName
      $metadata += [ordered]@{
        syncSource = "desktop_sync"
        folderPath = $FolderPath
        folderName = Split-Path -Leaf $FolderPath
        relativePath = $relativePath
        localPath = $file.FullName
      }
    }
    $form.Add((New-Object System.Net.Http.StringContent(($metadata | ConvertTo-Json -Depth 8 -Compress), [System.Text.Encoding]::UTF8, "application/json")), "fileMetadata")

    foreach ($file in $Batch) {
      $stream = [System.IO.File]::OpenRead($file.FullName)
      [void]$streams.Add($stream)
      $content = New-Object System.Net.Http.StreamContent($stream)
      $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse((Get-MimeType -FilePath $file.FullName))
      $form.Add($content, "files", $file.Name)
    }

    $response = $client.PostAsync((Base-Url) + "/api/files", $form).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
      $serverMessage = $null
      try {
        $errorData = $body | ConvertFrom-Json
        if ($errorData.error) { $serverMessage = [string]$errorData.error }
      } catch {
        $serverMessage = $null
      }

      if ($serverMessage) { throw $serverMessage }
      throw "HTTP $([int]$response.StatusCode): $body"
    }

    return $body | ConvertFrom-Json
  } finally {
    foreach ($stream in $streams) { $stream.Dispose() }
    $form.Dispose()
    $client.Dispose()
  }
}

function Get-ExcelFingerprint {
  param([string]$ExcelPath)

  if (-not $ExcelPath -or -not (Test-Path -LiteralPath $ExcelPath -PathType Leaf)) {
    return ""
  }

  $info = Get-Item -LiteralPath $ExcelPath
  return "{0}|{1}|{2}" -f $info.FullName, $info.Length, $info.LastWriteTimeUtc.Ticks
}

function Sync-ExcelWorkbook {
  param([bool]$OnlyIfChanged = $false)

  $excelPath = $txtExcelPath.Text.Trim()
  if (-not $excelPath) {
    Write-Log "Selecciona el Excel maestro antes de sincronizar pedidos."
    return
  }

  if (-not (Test-Path -LiteralPath $excelPath -PathType Leaf)) {
    Write-Log "No encontre el Excel maestro: $excelPath"
    return
  }

  $fingerprint = Get-ExcelFingerprint -ExcelPath $excelPath
  if ($OnlyIfChanged -and $fingerprint -and $fingerprint -eq $script:LastExcelFingerprint) {
    Write-Log "Excel maestro sin cambios; no se sincronizo."
    return
  }

  $client = New-Object System.Net.Http.HttpClient
  $content = $null
  $stream = $null

  try {
    Write-Log "Sincronizando pedidos desde Excel maestro..."
    $stream = [System.IO.File]::Open($excelPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $memory = New-Object System.IO.MemoryStream
    try {
      $stream.CopyTo($memory)
      $fileBase64 = [Convert]::ToBase64String($memory.ToArray())
    } finally {
      $memory.Dispose()
      $stream.Dispose()
      $stream = $null
    }

    $payload = [ordered]@{
      user = $txtUser.Text.Trim()
      pin = $txtPin.Text
      fileName = [System.IO.Path]::GetFileName($excelPath)
      fileBase64 = $fileBase64
      defaultCustomer = $txtDefaultCustomer.Text.Trim()
      defaultOwner = $txtDefaultOwner.Text.Trim()
      defaultDestination = $cmbDefaultDestination.Text.Trim()
      defaultPriority = $cmbDefaultPriority.Text.Trim()
      defaultDispatchDate = $txtDefaultDispatch.Text.Trim()
      excludedSheets = $txtExcludedSheets.Text.Trim()
      removeMissingLines = [bool]$chkRemoveMissing.Checked
    }
    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, "application/json")

    $response = $client.PostAsync((Base-Url) + "/api/import/sync", $content).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $data = $body | ConvertFrom-Json

    if (-not $response.IsSuccessStatusCode) {
      if ($data.error) { throw [string]$data.error }
      throw "HTTP $([int]$response.StatusCode): $body"
    }

    $script:LastExcelFingerprint = $fingerprint
    $created = @($data.summary | Where-Object { $_.status -eq "created" }).Count
    $updated = @($data.summary | Where-Object { $_.status -eq "updated" }).Count
    $skipped = @($data.summary | Where-Object { $_.status -eq "skipped" }).Count
    Write-Log "Excel sincronizado: $created creado(s), $updated actualizado(s), $skipped omitido(s)."

    if ($data.skippedSheets) {
      Write-Log "Pestanas ignoradas: $([string]::Join(', ', @($data.skippedSheets)))"
    }

    Save-ConfigFromUi
    Load-Orders
  } catch {
    Write-Log "Error sincronizando Excel: $($_.Exception.Message)"
  } finally {
    if ($stream) { $stream.Dispose() }
    if ($content) { $content.Dispose() }
    $client.Dispose()
  }
}

function Sync-Row {
  param([System.Windows.Forms.DataGridViewRow]$Row)

  $orderId = [string]$Row.Cells["OrderId"].Value
  $code = [string]$Row.Cells["Code"].Value
  $folder = ([string]$Row.Cells["Folder"].Value).Trim()
  $order = Find-OrderById -OrderId $orderId
  if (-not $order) { throw "Pedido no encontrado en memoria: $code" }
  if (-not $folder) { throw "Selecciona una carpeta para $code" }

  $Row.Cells["Status"].Value = "Escaneando"
  [System.Windows.Forms.Application]::DoEvents()
  $files = @(Get-AllowedFiles -FolderPath $folder)
  $Row.Cells["Files"].Value = [string]$files.Count
  Write-Log "${code}: $($files.Count) archivo(s) detectados"
  if ($files.Count -eq 0) {
    $Row.Cells["Status"].Value = "Sin archivos"
    return
  }

  Save-FolderToFlip -Row $Row -Quiet $true
  $batches = @(Split-Batches -Files $files)
  $uploaded = 0
  $rejected = 0

  for ($i = 0; $i -lt $batches.Count; $i++) {
    $Row.Cells["Status"].Value = "Subiendo lote $($i + 1)/$($batches.Count)"
    [System.Windows.Forms.Application]::DoEvents()
    $result = Upload-Batch -Order $order -FolderPath $folder -Batch $batches[$i]
    $uploaded += @($result.uploaded).Count
    $rejected += @($result.rejected).Count
    Write-Log "  $code lote $($i + 1): $(@($result.uploaded).Count) ligados, $(@($result.rejected).Count) descartados"
  }

  $Row.Cells["Status"].Value = "Listo: $uploaded ligados, $rejected descartados"
}

function Sync-Selected {
  $row = Get-SelectedGridRow
  if (-not $row) {
    Write-Log "Selecciona un pedido."
    return
  }

  try {
    Save-ConfigFromUi
    Sync-Row -Row $row
  } catch {
    $row.Cells["Status"].Value = "Error"
    Write-Log "Error: $($_.Exception.Message)"
  }
}

function Sync-All {
  Save-ConfigFromUi
  foreach ($row in $grid.Rows) {
    if ($row.IsNewRow) { continue }
    $folder = ([string]$row.Cells["Folder"].Value).Trim()
    if (-not $folder) { continue }
    try {
      Sync-Row -Row $row
    } catch {
      $row.Cells["Status"].Value = "Error"
      Write-Log "Error en $($row.Cells["Code"].Value): $($_.Exception.Message)"
    }
  }
}

$script:Config = Load-Config
$script:LastExcelFingerprint = Get-ConfigText -Name "lastExcelFingerprint"

$form = New-Object System.Windows.Forms.Form
$form.Text = "Flip Sync Desktop"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(1180, 820)
$form.MinimumSize = New-Object System.Drawing.Size(1080, 720)

$top = New-Object System.Windows.Forms.Panel
$top.Dock = "Top"
$top.Height = 226
$top.Padding = New-Object System.Windows.Forms.Padding(12)
$form.Controls.Add($top)

$lblServer = New-Object System.Windows.Forms.Label
$lblServer.Text = "Servidor Flip"
$lblServer.Location = New-Object System.Drawing.Point(12, 12)
$lblServer.Size = New-Object System.Drawing.Size(100, 20)
$top.Controls.Add($lblServer)

$txtServer = New-Object System.Windows.Forms.TextBox
$txtServer.Location = New-Object System.Drawing.Point(12, 34)
$txtServer.Size = New-Object System.Drawing.Size(530, 24)
$txtServer.Text = [string]$script:Config.serverUrl
$top.Controls.Add($txtServer)

$lblUser = New-Object System.Windows.Forms.Label
$lblUser.Text = "Usuario"
$lblUser.Location = New-Object System.Drawing.Point(556, 12)
$lblUser.Size = New-Object System.Drawing.Size(80, 20)
$top.Controls.Add($lblUser)

$txtUser = New-Object System.Windows.Forms.ComboBox
$txtUser.Location = New-Object System.Drawing.Point(556, 34)
$txtUser.Size = New-Object System.Drawing.Size(120, 24)
$txtUser.DropDownStyle = "DropDownList"
[void]$txtUser.Items.AddRange([object[]]$script:Users)
$savedUser = [string]$script:Config.user
if (-not ($script:Users -contains $savedUser)) { $savedUser = "Gloria" }
$txtUser.SelectedItem = $savedUser
$top.Controls.Add($txtUser)

$lblPin = New-Object System.Windows.Forms.Label
$lblPin.Text = "PIN"
$lblPin.Location = New-Object System.Drawing.Point(690, 12)
$lblPin.Size = New-Object System.Drawing.Size(70, 20)
$top.Controls.Add($lblPin)

$txtPin = New-Object System.Windows.Forms.TextBox
$txtPin.Location = New-Object System.Drawing.Point(690, 34)
$txtPin.Size = New-Object System.Drawing.Size(90, 24)
$txtPin.UseSystemPasswordChar = $true
$txtPin.Text = [string]$script:Config.pin
$top.Controls.Add($txtPin)

$btnLoad = New-Object System.Windows.Forms.Button
$btnLoad.Text = "Cargar pedidos"
$btnLoad.Location = New-Object System.Drawing.Point(795, 31)
$btnLoad.Size = New-Object System.Drawing.Size(125, 30)
$btnLoad.Add_Click({
  try {
    Save-ConfigFromUi
    Load-Orders
  } catch {
    Write-Log "Error: $($_.Exception.Message)"
  }
})
$top.Controls.Add($btnLoad)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = "Guardar config"
$btnSave.Location = New-Object System.Drawing.Point(932, 31)
$btnSave.Size = New-Object System.Drawing.Size(125, 30)
$btnSave.Add_Click({ Save-ConfigFromUi })
$top.Controls.Add($btnSave)

$chkOverwrite = New-Object System.Windows.Forms.CheckBox
$chkOverwrite.Text = "Reemplazar archivos existentes"
$chkOverwrite.Location = New-Object System.Drawing.Point(12, 76)
$chkOverwrite.Size = New-Object System.Drawing.Size(220, 24)
$chkOverwrite.Checked = [bool]$script:Config.overwriteExisting
$top.Controls.Add($chkOverwrite)

$lblInterval = New-Object System.Windows.Forms.Label
$lblInterval.Text = "Auto cada min."
$lblInterval.Location = New-Object System.Drawing.Point(250, 78)
$lblInterval.Size = New-Object System.Drawing.Size(95, 20)
$top.Controls.Add($lblInterval)

$numInterval = New-Object System.Windows.Forms.NumericUpDown
$numInterval.Location = New-Object System.Drawing.Point(348, 75)
$numInterval.Minimum = 5
$numInterval.Maximum = 1440
$intervalValue = [int]($script:Config.intervalMinutes -as [int])
if ($intervalValue -lt 5) { $intervalValue = 30 }
if ($intervalValue -gt 1440) { $intervalValue = 1440 }
$numInterval.Value = [decimal]$intervalValue
$numInterval.Size = New-Object System.Drawing.Size(70, 24)
$top.Controls.Add($numInterval)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [int]$numInterval.Value * 60 * 1000
$timer.Add_Tick({
  Write-Log "Sincronizacion automatica iniciada."
  if ($chkAutoExcel.Checked) { Sync-ExcelWorkbook -OnlyIfChanged $true }
  Sync-All
})

$btnAuto = New-Object System.Windows.Forms.Button
$btnAuto.Text = "Iniciar auto"
$btnAuto.Location = New-Object System.Drawing.Point(435, 72)
$btnAuto.Size = New-Object System.Drawing.Size(100, 30)
$btnAuto.Add_Click({
  if ($timer.Enabled) {
    $timer.Stop()
    $btnAuto.Text = "Iniciar auto"
    Write-Log "Sincronizacion automatica detenida."
  } else {
    $timer.Interval = [int]$numInterval.Value * 60 * 1000
    Save-ConfigFromUi
    $timer.Start()
    $btnAuto.Text = "Detener auto"
    Write-Log "Sincronizacion automatica activa."
  }
})
$top.Controls.Add($btnAuto)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Seleccionar carpeta"
$btnBrowse.Location = New-Object System.Drawing.Point(550, 72)
$btnBrowse.Size = New-Object System.Drawing.Size(135, 30)
$btnBrowse.Add_Click({
  $row = Get-SelectedGridRow
  if (-not $row) {
    Write-Log "Selecciona un pedido."
    return
  }
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Selecciona la carpeta de etiquetas para $($row.Cells["Code"].Value)"
  $current = [string]$row.Cells["Folder"].Value
  if ($current -and (Test-Path -LiteralPath $current -PathType Container)) { $dialog.SelectedPath = $current }
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $row.Cells["Folder"].Value = $dialog.SelectedPath
    Save-ConfigFromUi
  }
})
$top.Controls.Add($btnBrowse)

$btnSaveFolder = New-Object System.Windows.Forms.Button
$btnSaveFolder.Text = "Guardar carpeta en Flip"
$btnSaveFolder.Location = New-Object System.Drawing.Point(700, 72)
$btnSaveFolder.Size = New-Object System.Drawing.Size(155, 30)
$btnSaveFolder.Add_Click({
  $row = Get-SelectedGridRow
  if (-not $row) {
    Write-Log "Selecciona un pedido."
    return
  }
  try {
    Save-ConfigFromUi
    Save-FolderToFlip -Row $row
  } catch {
    Write-Log "Error: $($_.Exception.Message)"
  }
})
$top.Controls.Add($btnSaveFolder)

$btnSync = New-Object System.Windows.Forms.Button
$btnSync.Text = "Sincronizar seleccionado"
$btnSync.Location = New-Object System.Drawing.Point(870, 72)
$btnSync.Size = New-Object System.Drawing.Size(165, 30)
$btnSync.Add_Click({ Sync-Selected })
$top.Controls.Add($btnSync)

$lblExcel = New-Object System.Windows.Forms.Label
$lblExcel.Text = "Excel maestro de pedidos"
$lblExcel.Location = New-Object System.Drawing.Point(12, 116)
$lblExcel.Size = New-Object System.Drawing.Size(180, 20)
$top.Controls.Add($lblExcel)

$txtExcelPath = New-Object System.Windows.Forms.TextBox
$txtExcelPath.Location = New-Object System.Drawing.Point(12, 138)
$txtExcelPath.Size = New-Object System.Drawing.Size(655, 24)
$txtExcelPath.Text = Get-ConfigText -Name "excelPath"
$top.Controls.Add($txtExcelPath)

$btnBrowseExcel = New-Object System.Windows.Forms.Button
$btnBrowseExcel.Text = "Elegir Excel"
$btnBrowseExcel.Location = New-Object System.Drawing.Point(680, 135)
$btnBrowseExcel.Size = New-Object System.Drawing.Size(105, 30)
$btnBrowseExcel.Add_Click({
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = "Selecciona Contenedores Orvel Europa.xlsx"
  $dialog.Filter = "Excel (*.xlsx)|*.xlsx"
  $current = $txtExcelPath.Text.Trim()
  if ($current -and (Test-Path -LiteralPath $current -PathType Leaf)) {
    $dialog.InitialDirectory = Split-Path -Parent $current
    $dialog.FileName = Split-Path -Leaf $current
  }
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $txtExcelPath.Text = $dialog.FileName
    $script:LastExcelFingerprint = ""
    Save-ConfigFromUi
  }
})
$top.Controls.Add($btnBrowseExcel)

$btnSyncExcel = New-Object System.Windows.Forms.Button
$btnSyncExcel.Text = "Sincronizar Excel"
$btnSyncExcel.Location = New-Object System.Drawing.Point(798, 135)
$btnSyncExcel.Size = New-Object System.Drawing.Size(135, 30)
$btnSyncExcel.Add_Click({
  Save-ConfigFromUi
  Sync-ExcelWorkbook
})
$top.Controls.Add($btnSyncExcel)

$chkAutoExcel = New-Object System.Windows.Forms.CheckBox
$chkAutoExcel.Text = "Auto Excel"
$chkAutoExcel.Location = New-Object System.Drawing.Point(946, 139)
$chkAutoExcel.Size = New-Object System.Drawing.Size(95, 24)
$chkAutoExcel.Checked = Get-ConfigBool -Name "syncExcelEnabled" -Fallback $true
$top.Controls.Add($chkAutoExcel)

$lblDefaults = New-Object System.Windows.Forms.Label
$lblDefaults.Text = "Valores para pedidos nuevos"
$lblDefaults.Location = New-Object System.Drawing.Point(12, 172)
$lblDefaults.Size = New-Object System.Drawing.Size(180, 20)
$top.Controls.Add($lblDefaults)

$txtDefaultCustomer = New-Object System.Windows.Forms.TextBox
$txtDefaultCustomer.Location = New-Object System.Drawing.Point(12, 194)
$txtDefaultCustomer.Size = New-Object System.Drawing.Size(120, 24)
$txtDefaultCustomer.Text = Get-ConfigText -Name "defaultCustomer" -Fallback "CREVEL"
$top.Controls.Add($txtDefaultCustomer)

$txtDefaultOwner = New-Object System.Windows.Forms.TextBox
$txtDefaultOwner.Location = New-Object System.Drawing.Point(145, 194)
$txtDefaultOwner.Size = New-Object System.Drawing.Size(135, 24)
$txtDefaultOwner.Text = Get-ConfigText -Name "defaultOwner" -Fallback "Operaciones MX"
$top.Controls.Add($txtDefaultOwner)

$cmbDefaultDestination = New-Object System.Windows.Forms.ComboBox
$cmbDefaultDestination.Location = New-Object System.Drawing.Point(293, 194)
$cmbDefaultDestination.Size = New-Object System.Drawing.Size(95, 24)
$cmbDefaultDestination.DropDownStyle = "DropDownList"
[void]$cmbDefaultDestination.Items.AddRange([object[]]@("mexico", "usa", "europa", "otro"))
$savedDestination = Get-ConfigText -Name "defaultDestination" -Fallback "mexico"
if (-not (@("mexico", "usa", "europa", "otro") -contains $savedDestination)) { $savedDestination = "mexico" }
$cmbDefaultDestination.SelectedItem = $savedDestination
$top.Controls.Add($cmbDefaultDestination)

$cmbDefaultPriority = New-Object System.Windows.Forms.ComboBox
$cmbDefaultPriority.Location = New-Object System.Drawing.Point(400, 194)
$cmbDefaultPriority.Size = New-Object System.Drawing.Size(85, 24)
$cmbDefaultPriority.DropDownStyle = "DropDownList"
[void]$cmbDefaultPriority.Items.AddRange([object[]]@("critica", "alta", "media", "baja"))
$savedPriority = Get-ConfigText -Name "defaultPriority" -Fallback "media"
if (-not (@("critica", "alta", "media", "baja") -contains $savedPriority)) { $savedPriority = "media" }
$cmbDefaultPriority.SelectedItem = $savedPriority
$top.Controls.Add($cmbDefaultPriority)

$txtDefaultDispatch = New-Object System.Windows.Forms.TextBox
$txtDefaultDispatch.Location = New-Object System.Drawing.Point(498, 194)
$txtDefaultDispatch.Size = New-Object System.Drawing.Size(105, 24)
$txtDefaultDispatch.Text = Get-ConfigText -Name "defaultDispatchDate" -Fallback (Get-Date -Format "yyyy-MM-dd")
$top.Controls.Add($txtDefaultDispatch)

$txtExcludedSheets = New-Object System.Windows.Forms.TextBox
$txtExcludedSheets.Location = New-Object System.Drawing.Point(616, 194)
$txtExcludedSheets.Size = New-Object System.Drawing.Size(220, 24)
$txtExcludedSheets.Text = Get-ConfigText -Name "excludedSheets" -Fallback "MASTER,BODEGA,DV,CAT"
$top.Controls.Add($txtExcludedSheets)

$chkRemoveMissing = New-Object System.Windows.Forms.CheckBox
$chkRemoveMissing.Text = "Quitar lineas ausentes del Excel"
$chkRemoveMissing.Location = New-Object System.Drawing.Point(850, 195)
$chkRemoveMissing.Size = New-Object System.Drawing.Size(210, 24)
$chkRemoveMissing.Checked = Get-ConfigBool -Name "removeMissingLines"
$top.Controls.Add($chkRemoveMissing)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Dock = "Fill"
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.SelectionMode = "FullRowSelect"
$grid.MultiSelect = $false
$grid.AutoSizeColumnsMode = "None"
$grid.RowHeadersVisible = $false
$form.Controls.Add($grid)

[void]$grid.Columns.Add("OrderId", "OrderId")
$grid.Columns["OrderId"].Visible = $false
[void]$grid.Columns.Add("Code", "Pedido")
$grid.Columns["Code"].Width = 150
$grid.Columns["Code"].ReadOnly = $true
[void]$grid.Columns.Add("Customer", "Cliente")
$grid.Columns["Customer"].Width = 150
$grid.Columns["Customer"].ReadOnly = $true
[void]$grid.Columns.Add("Folder", "Carpeta")
$grid.Columns["Folder"].Width = 410
[void]$grid.Columns.Add("Files", "Archivos")
$grid.Columns["Files"].Width = 70
$grid.Columns["Files"].ReadOnly = $true
[void]$grid.Columns.Add("Status", "Estado")
$grid.Columns["Status"].Width = 230
$grid.Columns["Status"].ReadOnly = $true

$bottom = New-Object System.Windows.Forms.Panel
$bottom.Dock = "Bottom"
$bottom.Height = 190
$bottom.Padding = New-Object System.Windows.Forms.Padding(12)
$form.Controls.Add($bottom)

$btnSyncAll = New-Object System.Windows.Forms.Button
$btnSyncAll.Text = "Sincronizar todos con carpeta"
$btnSyncAll.Location = New-Object System.Drawing.Point(12, 10)
$btnSyncAll.Size = New-Object System.Drawing.Size(200, 30)
$btnSyncAll.Add_Click({ Sync-All })
$bottom.Controls.Add($btnSyncAll)

$btnOpenWeb = New-Object System.Windows.Forms.Button
$btnOpenWeb.Text = "Abrir Flip web"
$btnOpenWeb.Location = New-Object System.Drawing.Point(225, 10)
$btnOpenWeb.Size = New-Object System.Drawing.Size(110, 30)
$btnOpenWeb.Add_Click({ Start-Process (Base-Url) })
$bottom.Controls.Add($btnOpenWeb)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$txtLog.Location = New-Object System.Drawing.Point(12, 50)
$txtLog.Size = New-Object System.Drawing.Size(1010, 125)
$txtLog.Anchor = "Left,Right,Top,Bottom"
$bottom.Controls.Add($txtLog)

$form.Add_Shown({
  Write-Log "Flip Sync Desktop listo."
  Write-Log "Carga pedidos, selecciona carpeta por pedido y sincroniza."
})

[void][System.Windows.Forms.Application]::Run($form)
