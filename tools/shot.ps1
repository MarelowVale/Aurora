param(
  [string]$Out = "D:\Aurora\tools\shot.png",
  [int]$Wait = 3,
  [switch]$Full
)

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AurWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT pvAttribute, int cbAttribute);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

[void][AurWin]::SetProcessDPIAware()

$p = Get-Process Aurora -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "NO_WINDOW"; exit 1 }

$h = $p.MainWindowHandle
if ([AurWin]::IsIconic($h)) { [void][AurWin]::ShowWindow($h, 9) }
[void][AurWin]::SetForegroundWindow($h)
Start-Sleep -Milliseconds ([Math]::Max(300, $Wait * 300))

$r = New-Object AurWin+RECT
$ok = [AurWin]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)
if (-not $ok -or ($r.Right - $r.Left) -le 0) { [void][AurWin]::GetWindowRect($h, [ref]$r) }

$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if ($w -le 0 -or $ht -le 0) { Write-Output "BAD_RECT"; exit 2 }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)

if ($Full) {
  $hdc = $g.GetHdc()
  [void][AurWin]::PrintWindow($h, $hdc, 2)
  $g.ReleaseHdc($hdc)
} else {
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht))
}

$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("SAVED {0} {1}x{2} at {3},{4}" -f $Out, $w, $ht, $r.Left, $r.Top)
