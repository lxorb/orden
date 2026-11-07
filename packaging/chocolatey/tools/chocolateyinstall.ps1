$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.21.0/Orden-0.21.0-windows-x64.msi'
  checksum       = 'CEDBECEF0071789EE65CC79594B45142EB3243447F4327E4C125AD1D4A7ED649'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.21.0/Orden-0.21.0-windows-arm64.msi'
  $packageArgs['checksum'] = '30B75E6349811F84A56C9FA0B9706DBF0245EB19226631EF5EABF5481C73D910'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
