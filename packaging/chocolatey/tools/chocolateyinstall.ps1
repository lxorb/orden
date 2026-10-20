$ErrorActionPreference = 'Stop'

# Chocolatey installs for the whole machine, so this package uses the MSI
# (ALLUSERS=1, Program Files) rather than the NSIS setup.exe, which is a
# per-user install and would land in the elevated account's %LOCALAPPDATA%.
#
# The url and checksum are spelled out as literals, never built from variables:
# the community repository's validator reads them straight out of this file
# (CPMR0073) and treats anything it cannot read as a download with no checksum.
# The release workflow rewrites all four literals when it publishes.
#
# The release page names its installers "Orden-" since 0.15; the "Nib-" copies
# on the `updates` pre-release are the updater's. softwareName is what the MSI
# registers in Add/Remove Programs, which is the product's name, Orden. The MSI replaces one made under
# either old name, Nib or nibeditor, in place: it keeps their upgrade code.
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/orden/releases/download/v0.17.0/Orden-0.17.0-windows-x64.msi'
  checksum       = '77DF9006DD9BA0C2A5DBC99B9B6DB6C36A800AB6A1F96667F6D79EB1D654B45A'
  checksumType   = 'sha256'
  softwareName   = 'Orden'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

# Chocolatey's own url/url64bit pair has no slot for ARM64, and an ARM64 machine
# reports as 64-bit, so the architecture is picked by hand here.
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/orden/releases/download/v0.17.0/Orden-0.17.0-windows-arm64.msi'
  $packageArgs['checksum'] = '07674AE5564060AD7EEDD44A22CCCD772085660BE9C043CCB595B8E96711B273'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'Orden requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
