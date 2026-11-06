$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.19.0/Orden-0.19.0-windows-x64.msi'
  checksum       = '09FD05E626E20550BC03685927F7124C7F1A15D9BF511B85E44C2C302992BB8F'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.19.0/Orden-0.19.0-windows-arm64.msi'
  $packageArgs['checksum'] = 'A3AFE0C5A8FDF49D50BD3A92E79ABCF03EEA168FC2F71FA38D36023F6E77B922'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
