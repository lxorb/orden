$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.22.1/Orden-0.22.1-windows-x64.msi'
  checksum       = '4DCC7484B2397717CDAE69498418EF233231D07AD848A1461899523C8248FEB5'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.22.1/Orden-0.22.1-windows-arm64.msi'
  $packageArgs['checksum'] = 'A89054FF18D788E0D497C34E6CE804C64D4ADC997B5AC3B19BE35D5A6E432510'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
