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
  throw 'Nib requires 64-bit Windows (x64 or ARM64).'
}

# Chocolatey hands the package's own version down, so only the checksums below
# have to be rewritten when a release is published.
$version = $env:ChocolateyPackageVersion
$checksums = @{
  'x64'   = '3E137958BD559F1FA847AEC9E0251FC05B1A31D5C2F059ADCA7DCF8C1808508E'
  'arm64' = '1F7663B102F001D972F21AD795FD0B1C74DEFAF58263E9A8662B58BBBBFC4ACB'
}

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = "https://github.com/lxorb/nib/releases/download/v$version/Nib-$version-windows-$arch.msi"
  checksum       = $checksums[$arch]
  checksumType   = 'sha256'
  softwareName   = 'Nib'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

Install-ChocolateyPackage @packageArgs
