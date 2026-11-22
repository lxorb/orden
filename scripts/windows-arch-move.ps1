param(
  [Parameter(Mandatory)][string]$Old,
  [Parameter(Mandatory)][string]$New
)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'this installs and uninstalls for real; it runs on a CI runner only' }

$wrong = [System.Collections.Generic.List[string]]::new()
function Check([string]$what, [bool]$held) {
  if ($held) { Write-Host "ok     $what" } else { Write-Host "WRONG  $what"; $wrong.Add($what) }
}

function Machine([string]$file) {
  $stream = [System.IO.File]::OpenRead($file)
  try {
    $bytes = New-Object byte[] 4096
    $read = $stream.Read($bytes, 0, $bytes.Length)
  } finally { $stream.Dispose() }
  if ($read -lt 0x40 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { return 'other' }
  $pe = [BitConverter]::ToInt32($bytes, 0x3c)
  if ($pe -lt 0 -or $pe + 6 -gt $read -or [BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550) { return 'other' }
  switch ([BitConverter]::ToUInt16($bytes, $pe + 4)) {
    0x8664 { 'x64' }
    0xAA64 { 'arm64' }
    default { 'other' }
  }
}

function Copies([string]$dir) {
  $root = $dir.TrimEnd('\') + '\'
  @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
}

function Started([string]$exe) {
  $process = Start-Process -FilePath $exe -PassThru
  $deadline = (Get-Date).AddSeconds(120)
  do { Start-Sleep -Seconds 1 } until ((Copies (Split-Path $exe)).Count -ge 3 -or (Get-Date) -gt $deadline)
  Start-Sleep -Seconds 5
  Write-Host "  $exe runs as $((Copies (Split-Path $exe)).Count) processes"
  return $process
}

$oldSetup = (Get-ChildItem $Old -Recurse -Filter '*-windows-x64-setup.exe' | Select-Object -First 1).FullName
$newSetup = (Get-ChildItem $New -Recurse -Filter '*-setup.exe' | Select-Object -First 1).FullName
$place = "$env:LOCALAPPDATA\Orden"
$data = "$env:APPDATA\so.orden.Orden"
$uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Orden'

Write-Host "> $oldSetup /S"
(Start-Process -FilePath $oldSetup -ArgumentList '/S' -Wait -PassThru).ExitCode | Out-Null
Check 'the x64 release installs on the arm64 machine' ((Test-Path "$place\orden.exe") -and (Machine "$place\orden.exe") -eq 'x64')
$running = Started "$place\orden.exe"
Check 'and runs, under emulation' ((Copies $place).Count -gt 0)
New-Item -ItemType Directory -Force $data | Out-Null
$mark = "$data\arch-move-$([guid]::NewGuid()).txt"
Set-Content -LiteralPath $mark -Value 'kept'
$before = @(Get-ChildItem -LiteralPath $data -Recurse -File | ForEach-Object { $_.FullName })

$was = @(Copies $place | ForEach-Object { $_.ProcessId })
Write-Host "> $newSetup /P /UPDATE, with $($was.Count) processes running"
$setup = Start-Process -FilePath $newSetup -ArgumentList '/P /UPDATE' -PassThru
Start-Sleep -Milliseconds 500
Stop-Process -Id $running.Id -Force -ErrorAction SilentlyContinue
$finished = $setup.WaitForExit(240000)
Check 'the arm64 update finished' ($finished -and $setup.ExitCode -eq 0)
Start-Sleep -Seconds 3
$left = @(Get-CimInstance Win32_Process | Where-Object { $was -contains $_.ProcessId })
Check 'and nothing of the x64 copy is left running' ($left.Count -eq 0)

Check 'the program in its place is the arm64 build' ((Test-Path "$place\orden.exe") -and (Machine "$place\orden.exe") -eq 'arm64')
$x64 = @(Get-ChildItem -LiteralPath $place -Recurse -Include '*.exe', '*.dll' -File | Where-Object { (Machine $_.FullName) -eq 'x64' })
$x64 | Select-Object -First 10 | ForEach-Object { Write-Host "  x64 left: $($_.FullName)" }
Check 'and no x64 program or library of the old build is left beside it' ($x64.Count -eq 0)
$entries = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Orden' })
Check 'one Apps & Features entry, the new version' ($entries.Count -eq 1 -and (Get-ItemProperty $uninstall).DisplayVersion -eq $env:NEW)
Check "what the user had is still there" ((Test-Path -LiteralPath $mark) -and (Get-Content -LiteralPath $mark) -eq 'kept')
$after = @(Get-ChildItem -LiteralPath $data -Recurse -File | ForEach-Object { $_.FullName })
$lost = @($before | Where-Object { $after -notcontains $_ })
$lost | Select-Object -First 10 | ForEach-Object { Write-Host "  lost: $_" }
Check 'and no file of the profile went' ($lost.Count -eq 0)

$again = Started "$place\orden.exe"
$native = @(Copies $place | Where-Object { $_.Name -eq 'orden.exe' })
Check 'the arm64 build starts' ($native.Count -gt 0)
Stop-Process -Id $again.Id -Force -ErrorAction SilentlyContinue
Copies $place | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($wrong.Count) { Write-Host "$($wrong.Count) wrong"; exit 1 }
Write-Host 'an x64 install on an arm64 machine moved to the arm64 build and kept what it had'
