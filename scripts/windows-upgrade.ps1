param(
  [Parameter(Mandatory)][ValidateSet('updater', 'silent', 'elsewhere', 'msi')][string]$Scenario,
  [Parameter(Mandatory)][string]$Old,
  [Parameter(Mandatory)][ValidateSet('Nib', 'nibeditor')][string]$OldName,
  [string]$Via = '',
  [ValidateSet('', 'nibeditor', 'Orden')][string]$ViaName = '',
  [Parameter(Mandatory)][string]$New,
  [Parameter(Mandatory)][string]$Sfta
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'this installs and uninstalls for real; it runs on a CI runner only' }
if (($Via -eq '') -ne ($ViaName -eq '')) { throw '-Via and -ViaName go together' }

$names = @('Nib', 'nibeditor', 'Orden')
$product = 'Orden'
$before = if ($ViaName) { $ViaName } else { $OldName }

$wrong = [System.Collections.Generic.List[string]]::new()
function Check([string]$what, [bool]$held) {
  if ($held) { Write-Host "ok     $what" } else { Write-Host "WRONG  $what"; $wrong.Add($what) }
}

function Run([string]$file, [string]$arguments) {
  Write-Host "> $file $arguments"
  $process = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
  Write-Host "  exit $($process.ExitCode)"
  return $process.ExitCode
}

function Value([string]$key, [string]$name = '(default)') {
  $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  if (-not $item) { return $null }
  return $item.$name
}

function Has([string]$key) { Test-Path -LiteralPath $key }

function Program([string]$dir) {
  foreach ($name in 'orden.exe', 'nib.exe') {
    if (Test-Path "$dir\$name") { return "$dir\$name" }
  }
  return $null
}

function Copies([string[]]$dirs) {
  $roots = @($dirs | ForEach-Object { $_.TrimEnd('\') + '\' })
  @(Get-CimInstance Win32_Process | Where-Object {
      $path = $_.ExecutablePath
      $path -and $_.Name -ne 'uninstall.exe' -and @($roots | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    })
}

function Started([string]$exe, [int]$least) {
  $process = Start-Process -FilePath $exe -PassThru
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Seconds 1
    $copies = Copies @(Split-Path $exe)
  } until ($copies.Count -ge $least -or (Get-Date) -gt $deadline)
  Start-Sleep -Seconds 5
  $copies = Copies @(Split-Path $exe)
  Write-Host "  $exe runs as $($copies.Count) processes:"
  $copies | ForEach-Object { Write-Host "    $($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }
  return $process
}

function Served([string]$exe) {
  $info = New-Object System.Diagnostics.ProcessStartInfo $exe, 'mcp'
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $server = [System.Diagnostics.Process]::Start($info)
  Start-Sleep -Seconds 3
  Write-Host "  an agent's MCP server runs from it as process $($server.Id), exited: $($server.HasExited)"
  return $server
}

function Updated([string]$what, [string]$arguments, [string[]]$dirs, $running) {
  $was = @(Copies $dirs | ForEach-Object { $_.ProcessId })
  Write-Host "> $($built.Setup) $arguments, with $($was.Count) processes running"
  $setup = Start-Process -FilePath $built.Setup -ArgumentList $arguments -PassThru
  if ($arguments -like '*/UPDATE*') {
    Start-Sleep -Milliseconds 500
    Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
  }
  $finished = $setup.WaitForExit(240000)
  $code = if ($finished) { $setup.ExitCode } else { 'still running' }
  if (-not $finished) { Stop-Process -Id $setup.Id -Force -ErrorAction SilentlyContinue }
  Write-Host "  exit $code"
  $left = @(Get-CimInstance Win32_Process | Where-Object { $was -contains $_.ProcessId })
  $left | ForEach-Object { Write-Host "  left: $($_.ProcessId) $($_.CommandLine)" }
  Check "${what}: the setup finished" ($finished -and $code -eq 0)
  Check "${what}: and nothing of the running copy is left" ($was.Count -gt 0 -and $left.Count -eq 0)
}

function Starts([string]$command) {
  if ($command -notmatch '^"([^"]+)"') { return $null }
  $file = Get-Item -LiteralPath $Matches[1] -ErrorAction SilentlyContinue
  if ($file) { return $file.FullName } else { return $Matches[1] }
}

Add-Type -Namespace Orden -Name Shell -MemberDefinition @'
[DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
public static extern uint AssocQueryString(uint flags, uint what, string assoc, string extra, System.Text.StringBuilder found, ref uint size);
'@

function Handler([string]$scheme, [uint32]$what) {
  $found = New-Object System.Text.StringBuilder 1024
  $size = [uint32]1024
  [void][Orden.Shell]::AssocQueryString(0x1000, $what, $scheme, $null, $found, [ref]$size)
  return $found.ToString()
}

function Shortcut([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $folder = (New-Object -ComObject Shell.Application).Namespace((Split-Path $path))
  $id = $folder.ParseName((Split-Path $path -Leaf)).ExtendedProperty('System.AppUserModel.ID')
  return [pscustomobject]@{ Target = $link.TargetPath; Id = $id }
}

function Show([string]$when) {
  Write-Host "--- $when"
  $keys = foreach ($name in $names) {
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$name"
    "HKCU:\Software\Emil Vinu\$name"
    "HKCU:\Software\Clients\StartMenuInternet\$name\shell\open\command"
  }
  foreach ($key in @($keys) + @('HKCU:\Software\Classes\NibURL\shell\open\command', 'HKCU:\Software\RegisteredApplications')) {
    if (Has $key) { Write-Host $key; Get-ItemProperty -LiteralPath $key | Format-List | Out-String | Write-Host }
  }
  Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.Publisher -eq 'Emil Vinu' } |
    ForEach-Object { Write-Host "HKLM uninstall: $($_.PSChildName) $($_.DisplayName) $($_.DisplayVersion) $($_.InstallLocation)" }
  $dirs = @($programs, $desktop, $commonPrograms, $commonDesktop, $pinned, $where) + @($names | ForEach-Object { "$commonPrograms\$_" })
  foreach ($dir in $dirs) {
    Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^(Uninstall )?(Nib|nibeditor|Orden)\.lnk$' } |
      ForEach-Object { $s = Shortcut $_.FullName; Write-Host "shortcut $($_.FullName) -> $($s.Target) [$($s.Id)]" }
  }
  Write-Host "http: $(Handler 'http' 20)"
  Write-Host "https: $(Handler 'https' 20)"
}

function Files([string]$dir) {
  [pscustomobject]@{
    Setup = (Get-ChildItem $dir -Filter '*-setup.exe' | Select-Object -First 1).FullName
    Msi = (Get-ChildItem $dir -Filter '*.msi' | Select-Object -First 1).FullName
  }
}

$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('Desktop')
$commonPrograms = [Environment]::GetFolderPath('CommonPrograms')
$commonDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$pinned = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
$where = ''
$first = Files $Old
$built = Files $New
$version = (Get-Item $built.Setup).Name -replace '^[^_]+_([^_]+)_.*$', '$1'

$hkcu = 'HKCU:\Software'
$uninstall = "$hkcu\Microsoft\Windows\CurrentVersion\Uninstall"
$clients = "$hkcu\Clients\StartMenuInternet"
$registered = "$hkcu\RegisteredApplications"

if ($Scenario -eq 'msi') {
  Run 'msiexec.exe' "/i `"$($first.Msi)`" /qn /l*v `"$env:RUNNER_TEMP\old-msi.log`"" | Out-Null
  $dir = "$env:ProgramFiles\$OldName"
} else {
  Run $first.Setup '/S' | Out-Null
  $dir = "$env:LOCALAPPDATA\$OldName"
}
$where = $dir
Check "$OldName is installed in $dir" ($null -ne (Program $dir))

if ($Via) {
  $later = Files $Via
  if ($Scenario -eq 'msi') {
    Run 'msiexec.exe' "/i `"$($later.Msi)`" /qn /l*v `"$env:RUNNER_TEMP\via-msi.log`"" | Out-Null
  } else {
    Run $later.Setup '/S' | Out-Null
  }
  Check "$ViaName is installed in $dir" (($null -ne (Program $dir)) -and $null -eq (Program ($dir -replace '[^\\]+$', $ViaName)))
}

. $Sfta
foreach ($scheme in 'http', 'https') { Set-PTA -ProgId 'NibURL' -Protocol $scheme }
$chosen = (Handler 'http' 20) -eq 'NibURL' -and (Handler 'https' 20) -eq 'NibURL'
if (-not $chosen) { Write-Host '::warning::this runner did not take the default browser; the choice is not checked' }
Show 'before'
$hadDesktop = Test-Path "$desktop\$before.lnk"
$pin = "$pinned\$before.lnk"
if ($Scenario -ne 'msi') {
  New-Item -ItemType Directory -Force $pinned | Out-Null
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($pin)
  $link.TargetPath = (Shortcut "$programs\$before.lnk").Target
  $link.Save()
}

$moved = "$env:LOCALAPPDATA\$product"
if ($Scenario -ne 'msi') { $oldCopy = Started (Program $dir) 1 }
switch ($Scenario) {
  'updater' { Updated 'an update while the old copy runs' '/P /UPDATE' @($dir) $oldCopy; $want = $moved }
  'silent' { Updated 'a silent install while the old copy runs' '/S' @($dir) $oldCopy; $want = $moved }
  'elsewhere' { $want = 'C:\orden-elsewhere'; Updated 'an install elsewhere while the old copy runs' "/S /D=$want" @($dir) $oldCopy }
  'msi' { Run 'msiexec.exe' "/i `"$($built.Msi)`" /passive /norestart /l*v `"$env:RUNNER_TEMP\new-msi.log`"" | Out-Null; $want = $dir }
}
Show 'after'

$olds = @($names | Where-Object { $_ -ne $product })

$exe = "$want\orden.exe"
if ($Scenario -ne 'msi') {
  $held = Shortcut $pin
  Check 'the pinned taskbar button starts the program' ($held -and $held.Target -eq $exe)
}
Check "the program is in $want" (Test-Path $exe)
Check 'and the program under its former name is gone' (-not (Test-Path "$want\nib.exe"))
Check "and it is $version" ((Test-Path $exe) -and (Get-Item $exe).VersionInfo.ProductVersion -like "$version*")
if ($Scenario -eq 'msi') {
  Check 'no second folder under the new name' (-not (Test-Path "$env:ProgramFiles\$product"))
  $entries = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
      ForEach-Object { Get-ItemProperty $_.PSPath } |
      Where-Object { $_.Publisher -eq 'Emil Vinu' -and $_.DisplayName -in $names })
  Check 'one entry in Apps & Features' ($entries.Count -eq 1)
  Check "and it is $product $version" ($entries.Count -eq 1 -and $entries[0].DisplayName -ceq $product -and $entries[0].DisplayVersion -eq $version)
  $start = Shortcut "$commonPrograms\$product\$product.lnk"
  Check "the Start menu entry is $product and starts the program" ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'so.orden.Orden')
  foreach ($name in $olds) {
    Check "the $name Start menu entry is gone" (-not (Test-Path "$commonPrograms\$name\$name.lnk"))
    Check "and its folder" (-not (Test-Path "$commonPrograms\$name"))
    Check "the $name desktop icon is gone" (-not (Test-Path "$commonDesktop\$name.lnk"))
    Check "the $name uninstall shortcut in the program's folder is gone" (-not (Test-Path "$want\Uninstall $name.lnk"))
  }
} else {
  Check "the old folder $dir is gone" (-not (Test-Path $dir))
  if ($Scenario -eq 'elsewhere') {
    Check 'no folder under the new name' (-not (Test-Path $moved))
  }
  foreach ($name in $olds) {
    Check "the $name Apps & Features entry is gone" (-not (Has "$uninstall\$name"))
    Check "the $name remembered folder is gone" (-not (Has "$hkcu\Emil Vinu\$name"))
    Check "the $name Start menu entry is gone" (-not (Test-Path "$programs\$name.lnk"))
    Check "the $name desktop icon is gone" (-not (Test-Path "$desktop\$name.lnk"))
  }
  Check 'the new one is there' ((Value "$uninstall\$product" 'DisplayName') -ceq $product)
  Check "and is $version" ((Value "$uninstall\$product" 'DisplayVersion') -eq $version)
  Check "and says it is in $want" ((Value "$uninstall\$product" 'InstallLocation') -eq "`"$want`"")
  Check 'the folder is remembered under the new name' ((Value "$hkcu\Emil Vinu\$product") -eq $want)
  $start = Shortcut "$programs\$product.lnk"
  Check "the Start menu entry is $product and starts the program" ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'so.orden.Orden')
  if ($hadDesktop) {
    $icon = Shortcut "$desktop\$product.lnk"
    Check "the desktop icon is $product and starts the program" ($icon -and $icon.Target -eq $exe)
  }
}

foreach ($name in $olds) {
  Check "the $name browser client is gone" (-not (Has "$clients\$name"))
  Check "and its line in RegisteredApplications" ($null -eq (Value $registered $name))
}
Check "the browser client is $product and starts the program" ((Starts (Value "$clients\$product\shell\open\command")) -eq $exe)
Check 'and is listed for Default apps' ((Value $registered $product) -eq "Software\Clients\StartMenuInternet\$product\Capabilities")
$link = Value "$hkcu\Classes\NibURL\shell\open\command"
Check 'the ProgID starts the program with a link' ((Starts $link) -eq $exe -and $link -like '* --url "%1"')
if ($chosen) {
  foreach ($scheme in 'http', 'https') {
    Check "the app is still the default for $scheme" ((Handler $scheme 20) -eq 'NibURL')
  }
}

$pdf = Value "$hkcu\Classes\NibPDF\shell\open\command"
Check 'the PDF ProgID starts the program with the file' ((Starts $pdf) -eq $exe -and $pdf -like '* "%1"')
Check 'and is offered in Open with' ($null -ne (Value "$hkcu\Classes\.pdf\OpenWithProgids" 'NibPDF'))
Check 'and the default for PDFs is left alone' ((Value "$hkcu\Classes\.pdf") -ne 'NibPDF')
$pdfIcon = "$want\documents\pdf.ico"
Check 'and shows a PDF document icon of its own' ((Value "$hkcu\Classes\NibPDF\DefaultIcon") -eq $pdfIcon -and (Test-Path -LiteralPath $pdfIcon))
Check 'and leaves the PDF type its own icon' ($null -eq (Value "$hkcu\Classes\.pdf\DefaultIcon") -or (Value "$hkcu\Classes\.pdf\DefaultIcon") -notlike "*$product*")

Add-Type -AssemblyName System.Drawing
function Picture([string]$file) {
  $bitmap = [System.Drawing.Icon]::ExtractAssociatedIcon($file).ToBitmap()
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  return [Convert]::ToBase64String($stream.ToArray())
}
$installed = if (Test-Path $exe) { $exe } else { Program $dir }
Check "the setup shows $product's icon" ((Picture $built.Setup) -eq (Picture $installed))

if ($Scenario -ne 'msi') {
  $place = Split-Path $installed
  $running = Started $installed 3
  Check 'the new copy runs with its helper processes' ((Copies @($place)).Count -ge 3)
  Updated 'an update of the new copy while it runs' '/P /UPDATE' @($place) $running
  Check 'and the program is still there' (Test-Path $installed)
  $running = Started $installed 3
  $server = Served $installed
  Updated 'a silent install over the new copy while it runs' '/S' @($place) $running
  Check 'and the program is still there' (Test-Path $installed)
  $running = Started $installed 3
}

if ($Scenario -eq 'msi') {
  $code = $entries[0].PSChildName
  Run 'msiexec.exe' "/x $code /qn" | Out-Null
} else {
  Run "$want\uninstall.exe" '/S' | Out-Null
  $deadline = (Get-Date).AddSeconds(120)
  do {
    Start-Sleep -Seconds 1
    $copies = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(Un|Au)_[A-Z]$' })
    $done = -not $copies -and -not (Test-Path $exe) -and -not (Has "$uninstall\$product")
  } until ($done -or (Get-Date) -gt $deadline)
  Write-Host "  uninstalled after $([int]((Get-Date) - $deadline.AddSeconds(-120)).TotalSeconds)s, done: $done"
  Start-Sleep -Seconds 2
}
Show 'uninstalled'
Check 'the program is gone' (-not (Test-Path $exe))
Check 'and its PDF document icon' (-not (Test-Path -LiteralPath $pdfIcon))
Check 'nothing in Open with for PDFs' (-not (Has "$hkcu\Classes\NibPDF") -and $null -eq (Value "$hkcu\Classes\.pdf\OpenWithProgids" 'NibPDF'))
foreach ($name in $names) {
  Check "no $name Apps & Features entry is left" (-not (Has "$uninstall\$name"))
  Check "no $name browser client is left" (-not (Has "$clients\$name"))
  Check "nothing of $name in RegisteredApplications" ($null -eq (Value $registered $name))
  $left = @("$programs\$name.lnk", "$desktop\$name.lnk", "$commonPrograms\$name\$name.lnk", "$commonDesktop\$name.lnk") |
    Where-Object { Test-Path $_ }
  Check "no $name shortcut is left $left" (-not $left)
}

Write-Host "$($wrong.Count) wrong"
exit $wrong.Count
