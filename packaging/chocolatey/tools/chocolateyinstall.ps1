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
# The asset name and softwareName below stay "Nib": that is the product name the
# bundle carries and what it registers in Add/Remove Programs, whatever the app
# is called on the website.
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'MSI'
  url            = 'https://github.com/lxorb/nibeditor/releases/download/v0.7.0/Nib-0.7.0-windows-x64.msi'
  checksum       = 'AC855DC04902CC0E15A779DF7B00F6005974BE588297614870B05A272DA25905'
  checksumType   = 'sha256'
  softwareName   = 'Nib'
  silentArgs     = '/qn /norestart'
  validExitCodes = @(0, 3010, 1641)
}

# Chocolatey's own url/url64bit pair has no slot for ARM64, and an ARM64 machine
# reports as 64-bit, so the architecture is picked by hand here.
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  $packageArgs['url'] = 'https://github.com/lxorb/nibeditor/releases/download/v0.7.0/Nib-0.7.0-windows-arm64.msi'
  $packageArgs['checksum'] = 'AD122D07C3F72D97611F2069EC6C26B7ACDEBBA1803D02132215A2C26DD08709'
} elseif ((Get-OSArchitectureWidth) -ne 64) {
  throw 'nibeditor requires 64-bit Windows (x64 or ARM64).'
}

Install-ChocolateyPackage @packageArgs
