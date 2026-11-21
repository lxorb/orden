$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.22.2/Orden-0.22.2-windows-x64.msi'
  checksum       = 'BC590E665510DF895DA88AEEE4083A5276BF444A78C9A107E326AA5E9ECFABD0'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.22.2/Orden-0.22.2-windows-arm64.msi'
  $packageArgs['checksum'] = '5B41796F4C9F8C18F33E51BF597528AC4AC01C1CA1F023A6E0D5AD569119F786'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
