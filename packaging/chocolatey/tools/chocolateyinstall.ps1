$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.23.0/Orden-0.23.0-windows-x64.msi'
  checksum       = 'B648ACC69B7F82849E68C316A6243CB7A6F23F19565C668E1FC22F184BCD2D97'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.23.0/Orden-0.23.0-windows-arm64.msi'
  $packageArgs['checksum'] = 'D2218C294160FD04CFF1CABD9C1A2A225815EBF0F708395BC426B1FB63C4F13E'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
