param([Parameter(Mandatory = $true)][string[]]$Path)

$utf8 = New-Object System.Text.UTF8Encoding($false)

foreach ($file in $Path) {
  $full = Resolve-Path $file
  $text = [System.IO.File]::ReadAllText($full, $utf8)

  $text = [regex]::Replace($text, "label: '([^']*)'", 'label: t(''$1'')')
  $ternary = "? t('`$1') : t('`$2')"
  $text = [regex]::Replace($text, "\? '([^']*)' : '([^']*)'", $ternary)

  [System.IO.File]::WriteAllText($full, $text, $utf8)
  Write-Output "wrapped $file"
}
