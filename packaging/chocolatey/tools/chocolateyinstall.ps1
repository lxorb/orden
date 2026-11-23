$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.22.3/Orden-0.22.3-windows-x64.msi'
  checksum       = 'B7C9108F7014A6585465FC3AC1998F738974F1C6007232BFE4A36570FF150C13'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.22.3/Orden-0.22.3-windows-arm64.msi'
  $packageArgs['checksum'] = '821BE733335BF8755D0622F480D112C760C38959AB4158B694352BB2F742A218'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
