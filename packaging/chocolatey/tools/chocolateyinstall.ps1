$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.20.0/Orden-0.20.0-windows-x64.msi'
  checksum       = 'CD23E03339880FCCAA495EC0AD24596CF3D779AFE83CAE510D577BFF9E8F32E4'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.20.0/Orden-0.20.0-windows-arm64.msi'
  $packageArgs['checksum'] = 'D962FAB9C927319CCC659E605C2C4DB1ED5289720EB5BE7C0120D4C0D32AD8AB'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
