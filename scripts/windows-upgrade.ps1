param(
  [Parameter(Mandatory)][ValidateSet('updater', 'silent', 'elsewhere', 'msi')][string]$Scenario,
  [Parameter(Mandatory)][string]$Old,
  [Parameter(Mandatory)][ValidateSet('Nib', 'nibeditor')][string]$OldName,
  [string]$Via = '',
  [ValidateSet('', 'nibeditor')][string]$ViaName = '',
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

function Starts([string]$command) {
  if ($command -notmatch '^"([^"]+)"') { return $null }
  $file = Get-Item -LiteralPath $Matches[1] -ErrorAction SilentlyContinue
  if ($file) { return $file.FullName } else { return $Matches[1] }
}

Add-Type -Namespace Nib -Name Shell -MemberDefinition @'
[DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
public static extern uint AssocQueryString(uint flags, uint what, string assoc, string extra, System.Text.StringBuilder found, ref uint size);
'@

function Handler([string]$scheme, [uint32]$what) {
  $found = New-Object System.Text.StringBuilder 1024
  $size = [uint32]1024
  [void][Nib.Shell]::AssocQueryString(0x1000, $what, $scheme, $null, $found, [ref]$size)
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
  $dirs = @($programs, $desktop, $commonPrograms, $commonDesktop, $where) + @($names | ForEach-Object { "$commonPrograms\$_" })
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
Check "$OldName is installed in $dir" (Test-Path "$dir\nib.exe")

if ($Via) {
  $later = Files $Via
  if ($Scenario -eq 'msi') {
    Run 'msiexec.exe' "/i `"$($later.Msi)`" /qn /l*v `"$env:RUNNER_TEMP\via-msi.log`"" | Out-Null
  } else {
    Run $later.Setup '/S' | Out-Null
  }
  Check "$ViaName is installed in $dir" ((Test-Path "$dir\nib.exe") -and -not (Test-Path "$($dir -replace '[^\\]+$', $ViaName)\nib.exe"))
}

. $Sfta
foreach ($scheme in 'http', 'https') { Set-PTA -ProgId 'NibURL' -Protocol $scheme }
$chosen = (Handler 'http' 20) -eq 'NibURL' -and (Handler 'https' 20) -eq 'NibURL'
if (-not $chosen) { Write-Host '::warning::this runner did not take the default browser; the choice is not checked' }
Show 'before'
$hadDesktop = Test-Path "$desktop\$before.lnk"

switch ($Scenario) {
  'updater' { Run $built.Setup '/P /UPDATE' | Out-Null; $want = $dir }
  'silent' { Run $built.Setup '/S' | Out-Null; $want = $dir }
  'elsewhere' { $want = 'C:\nib-elsewhere'; Run $built.Setup "/S /D=$want" | Out-Null }
  'msi' { Run 'msiexec.exe' "/i `"$($built.Msi)`" /passive /norestart /l*v `"$env:RUNNER_TEMP\new-msi.log`"" | Out-Null; $want = $dir }
}
Show 'after'

$olds = @($names | Where-Object { $_ -ne $product })

$exe = "$want\nib.exe"
Check "the program is in $want" (Test-Path $exe)
Check "and it is $version" ((Get-Item $exe).VersionInfo.ProductVersion -like "$version*")
if ($Scenario -eq 'msi') {
  Check 'no second folder under the new name' (-not (Test-Path "$env:ProgramFiles\$product"))
  $entries = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
      ForEach-Object { Get-ItemProperty $_.PSPath } |
      Where-Object { $_.Publisher -eq 'Emil Vinu' -and $_.DisplayName -in $names })
  Check 'one entry in Apps & Features' ($entries.Count -eq 1)
  Check "and it is $product $version" ($entries.Count -eq 1 -and $entries[0].DisplayName -ceq $product -and $entries[0].DisplayVersion -eq $version)
  $start = Shortcut "$commonPrograms\$product\$product.lnk"
  Check "the Start menu entry is $product and starts the program" ($start -and $start.Target -eq $exe)
  Check 'and carries the app id' ($start -and $start.Id -eq 'ch.emilvinu.nib')
  foreach ($name in $olds) {
    Check "the $name Start menu entry is gone" (-not (Test-Path "$commonPrograms\$name\$name.lnk"))
    Check "and its folder" (-not (Test-Path "$commonPrograms\$name"))
    Check "the $name desktop icon is gone" (-not (Test-Path "$commonDesktop\$name.lnk"))
    Check "the $name uninstall shortcut in the program's folder is gone" (-not (Test-Path "$want\Uninstall $name.lnk"))
  }
} else {
  if ($Scenario -eq 'elsewhere') {
    Check 'the old folder is gone' (-not (Test-Path "$dir\nib.exe"))
  }
  Check 'no folder under the new name' (-not (Test-Path "$env:LOCALAPPDATA\$product"))
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
  Check 'and carries the app id' ($start -and $start.Id -eq 'ch.emilvinu.nib')
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
