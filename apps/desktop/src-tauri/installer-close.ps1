param(
  [Parameter(Mandatory)][string]$Dirs,
  [switch]$Close,
  [int]$Patience = 10
)

$ErrorActionPreference = 'SilentlyContinue'
$programs = @('orden.exe', 'nib.exe')
$roots = @($Dirs -split '\|' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') + '\' })

function Running {
  @(Get-CimInstance Win32_Process | Where-Object {
      $path = $_.ExecutablePath
      $name = "$($_.Name)".ToLowerInvariant()
      if ($name -eq 'uninstall.exe') { return $false }
      if (-not $path) { return $programs -contains $name }
      @($roots | Where-Object { $path.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    })
}

function Left([int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  do {
    $left = Running
    if ($left.Count -eq 0) { return @() }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $until)
  return $left
}

function Say($found) {
  foreach ($one in $found) {
    $role = if ("$($one.CommandLine)" -match '--type=([\w-]+)') { " $($Matches[1])" } else { '' }
    "$($one.Name)$role (process $($one.ProcessId))"
  }
}

$found = Running
if (-not $Close) {
  Say $found
  exit $(if ($found.Count -gt 0) { 10 } else { 0 })
}

$ids = @($found | ForEach-Object { $_.ProcessId })
foreach ($one in @($found | Where-Object { $ids -notcontains $_.ParentProcessId })) {
  & taskkill.exe /PID $one.ProcessId 2>&1 | Out-Null
}
$left = Left $Patience
foreach ($one in $left) { Stop-Process -Id $one.ProcessId -Force }
$left = Left 10
Say $left
exit $(if ($left.Count -gt 0) { 11 } else { 0 })
