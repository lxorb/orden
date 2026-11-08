$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.21.1/Orden-0.21.1-windows-x64.msi'
  checksum       = '1EF80FE917646FB0725F2AC7A66D21E60EF85660C08444128CBB453685F378C4'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.21.1/Orden-0.21.1-windows-arm64.msi'
  $packageArgs['checksum'] = '7B75CCC7305F42BE9AFAAD018CDF71ABD8BFCE82A29EA83C7231325F2A6B5D20'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
