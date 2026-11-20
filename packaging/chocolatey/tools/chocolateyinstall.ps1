$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.22.0/Orden-0.22.0-windows-x64.msi'
  checksum       = '016D597EF3EF9C4584E45C1E9892D6B9C084C98F3FF7EFB224A6988863B0015E'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.22.0/Orden-0.22.0-windows-arm64.msi'
  $packageArgs['checksum'] = '60D94392E2FCFC7F7278586AC5595C8612E967E96C72C6934ADF9086D3782F7D'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
