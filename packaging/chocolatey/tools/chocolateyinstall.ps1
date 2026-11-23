$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.22.4/Orden-0.22.4-windows-x64.msi'
  checksum       = 'A34DEF3DB479EA9E721D7932A6027FB20BAD7C56EF6AAAE37BE9FCF2CD8B36C3'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.22.4/Orden-0.22.4-windows-arm64.msi'
  $packageArgs['checksum'] = 'E059FF73A15EDDD233584C4119E66A07235B365BD232216DE0D1AFFE077E32DF'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
