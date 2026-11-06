$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1605, 1614, 1641)
}

[array]$keys = @($packageArgs.softwareName, 'nibeditor', 'Nib') |
  ForEach-Object { Get-UninstallRegistryKey -SoftwareName $_ } |
  Where-Object { $_.PSChildName -match '^\{[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$' }

if ($keys.Count -eq 0) {
  Write-Warning "$($packageArgs.packageName) is not installed by this package - nothing to uninstall."
  return
}

if ($keys.Count -gt 1) {
  Write-Warning "$($keys.Count) matching installations found. None were removed; uninstall them by hand:"
  $keys | ForEach-Object { Write-Warning "  $($_.DisplayName) $($_.DisplayVersion) [$($_.PSChildName)]" }
  return
}

$packageArgs['file'] = ''
$packageArgs['silentArgs'] = "$($keys[0].PSChildName) $($packageArgs.silentArgs)"

Uninstall-ChocolateyPackage @packageArgs
