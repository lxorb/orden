$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.22.5/Orden-0.22.5-windows-x64.msi'
  checksum       = 'E386F203C788254089B7A3B4727F9A1DC7AFE5004ACD018D7446E5B8E9D5A137'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.22.5/Orden-0.22.5-windows-arm64.msi'
  $packageArgs['checksum'] = '70E2EEC44265DDD90EA261981079073CD6D4C0EFAF87844FBD84F2FA1528EE51'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
