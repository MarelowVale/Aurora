param([string]$Step = "list")

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AurUi {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT pv, int cb);
}
"@

Write-Output "STEP $Step"
$p = Get-Process Aurora -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "NO_WINDOW"; exit 1 }
$h = $p.MainWindowHandle
[void][AurUi]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 300

$r = New-Object AurUi+RECT
[void][AurUi]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)
$ox = $r.Left; $oy = $r.Top

function Click([int]$x, [int]$y) {
  [void][AurUi]::SetCursorPos($ox + $x, $oy + $y)
  Start-Sleep -Milliseconds 90
  [AurUi]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [AurUi]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 320
}

function Shot([string]$name) {
  $rr = New-Object AurUi+RECT
  [void][AurUi]::DwmGetWindowAttribute($h, 9, [ref]$rr, 16)
  $w = $rr.Right - $rr.Left; $ht = $rr.Bottom - $rr.Top
  $bmp = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rr.Left, $rr.Top, 0, 0, (New-Object System.Drawing.Size $w, $ht))
  $g.Dispose()
  $bmp.Save("D:\Aurora\tools\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "SHOT $name"
}

switch ($Step) {
  "list" {
    Click 1230 83          # 列表视图按钮
    Shot "s-list"
  }
  "select" {
    Click 480 200          # 选中第一行的某个文件夹
    Shot "s-select"
  }
  "menu" {
    Click 480 200
    [AurUi]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)  # 右键按下
    [AurUi]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)  # 右键抬起
    Start-Sleep -Milliseconds 450
    Shot "s-menu"
  }
  "palette" {
    [System.Windows.Forms.SendKeys]::SendWait("^k")
    Start-Sleep -Milliseconds 900
    Shot "s-palette"
  }
  "ai" {
    [System.Windows.Forms.SendKeys]::SendWait("^j")
    Start-Sleep -Milliseconds 1100
    Shot "s-ai"
  }
  "search" {
    [System.Windows.Forms.SendKeys]::SendWait("^f")
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("python")
    Start-Sleep -Milliseconds 1500
    Shot "s-search"
  }
  "esc" {
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Start-Sleep -Milliseconds 300
  }
  "settings" {
    [System.Windows.Forms.SendKeys]::SendWait("^,")
    Start-Sleep -Milliseconds 900
    Shot "s-settings"
  }
  default { Write-Output "unknown step" }
}
