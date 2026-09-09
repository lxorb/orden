$ErrorActionPreference = 'Stop'

# Chocolatey installs for the whole machine, so this package uses the MSI
# (ALLUSERS=1, Program Files) rather than the NSIS setup.exe, which is a
# per-user install and would land in the elevated account's %LOCALAPPDATA%.
#
# Chocolatey's own url/url64bit pair has no slot for ARM64, and an ARM64
# machine reports as 64-bit, so the architecture is picked by hand here.
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  'arm64'
} elseif ((Get-OSArchitectureWidth) -eq 64) {
  'x64'
} else {
  throw 'nibeditor requires 64-bit Windows (x64 or ARM64).'
}

# Chocolatey hands the package's own version down, so only the checksums below
# have to be rewritten when a release is published.
$version = $env:ChocolateyPackageVersion
$checksums = @{
  'x64'   = 'D3463E71D7690059D1DE5EF544216FC495651FF063559343346D3D07407F63BE'
  'arm64' = '0FB1FA05AF71E66AEB2A93F94FD3CE8DACD4DC1E605B8E45EF964FA4528F7C76'
}

# The asset name and softwareName below stay "Nib": that is the product name the
# bundle carries and what it registers in Add/Remove Programs, whatever the app
# is called on the website.
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = "https://github.com/lxorb/nibeditor/releases/download/v$version/Nib-$version-windows-$arch.msi"
  checksum       = $checksums[$arch]
  checksumType   = 'sha256'
  softwareName   = 'Nib'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

Install-ChocolateyPackage @packageArgs
