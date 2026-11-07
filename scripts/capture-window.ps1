param(
  [Alias('Pid')]
  [int]$ProcessId = 0,
  [string]$Out = "$env:TEMP\orden-window.png",
  [switch]$ListOnly
)

if ($ProcessId -le 0) {
  [Console]::Error.WriteLine('capture-window.ps1 needs -Pid <process id>: a window is photographed by pid, never by name.')
  exit 2
}

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class NibDpi {
  // Per-monitor v2, which is what a webview window is: the numbers below come back
  // in real pixels from here on. The older call is the fallback for a Windows that
  // has never heard of the newer one; both are allowed to fail, because a process
  // whose awareness is already set is a process that already answers in pixels.
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  public static void Ask() {
    try {
      if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
    } catch (EntryPointNotFoundException) {
    }

    try {
      SetProcessDPIAware();
    } catch (EntryPointNotFoundException) {
    }
  }
}

public class NibCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr param);

  // Draw everything, including what the window composites for itself. Without this a
  // webview's own content comes back blank, because a DirectComposition surface is not
  // part of what a window paints on request.
  public const int PW_RENDERFULLCONTENT = 2;

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr param);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

  public static List<string> Windows(uint pid) {
    var found = new List<string>();
    EnumWindows((hWnd, param) => {
      uint owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner != pid) return true;

      RECT r;
      GetWindowRect(hWnd, out r);
      var title = new StringBuilder(256);
      GetWindowTextW(hWnd, title, title.Capacity);
      found.Add(string.Format("{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}",
        hWnd.ToInt64(), IsWindowVisible(hWnd), r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top,
        IsIconic(hWnd), title));
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

[NibDpi]::Ask()

$process = Get-Process -Id $ProcessId -ErrorAction Stop

$rows = [NibCapture]::Windows($process.Id) | ForEach-Object {
  $parts = $_ -split '\|'
  [pscustomobject]@{
    Handle    = [int64]$parts[0]
    Visible   = [bool]::Parse($parts[1])
    X         = [int]$parts[2]
    Y         = [int]$parts[3]
    Width     = [int]$parts[4]
    Height    = [int]$parts[5]
    Minimized = [bool]::Parse($parts[6])
    Title     = $parts[7]
  }
}

if ($ListOnly) { return $rows | Sort-Object -Property Width -Descending }

$target = $rows |
  Where-Object { $_.Visible -and -not $_.Minimized -and $_.Width -gt 200 -and $_.Height -gt 200 } |
  Sort-Object -Property Width -Descending |
  Select-Object -First 1

if (-not $target) { throw "no sizeable visible window for process $($process.Id)" }

$handle = [IntPtr]$target.Handle

$rect = New-Object NibCapture+RECT
[void][NibCapture]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$hdc = $graphics.GetHdc()
$drew = [NibCapture]::PrintWindow($handle, $hdc, [NibCapture]::PW_RENDERFULLCONTENT)
$graphics.ReleaseHdc($hdc)

if (-not $drew) {
  $graphics.Dispose()
  $bitmap.Dispose()
  throw "window $($target.Handle) would not draw itself"
}

$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output "$Out ${width}x${height} pid $($process.Id)"
