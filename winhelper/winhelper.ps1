# winhelper.ps1 — پل بین پازل‌تب و ویندوز (شمارش/جابه‌جایی/زوم پنجره‌های واقعی)
# هر دستور یک خروجی JSON تک‌خطی روی stdout می‌دهد تا پردازش در Node ساده باشد.
# دستورها: list | rect | move | zoom | focus

param(
  [Parameter(Mandatory = $true)][ValidateSet('list', 'rect', 'move', 'zoom', 'focus')][string]$Cmd,
  [string]$Handle,
  [int]$X,
  [int]$Y,
  [int]$W,
  [int]$H,
  [int]$Steps = 0,
  [string]$BatchFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public struct RECT { public int Left, Top, Right, Bottom; }

public class WinAPI {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeRect(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] public static extern int DwmGetWindowAttributeInt(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
}
"@

$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$GW_OWNER = 4
$SW_RESTORE = 9
$SWP_SHOWWINDOW = 0x0040
$HWND_TOP = [IntPtr]::Zero
$DWMWA_CLOAKED = 14
$DWMWA_EXTENDED_FRAME_BOUNDS = 9

function Get-ExtendedRect([IntPtr]$h) {
  $r = New-Object RECT
  try {
    $ok = [WinAPI]::DwmGetWindowAttributeRect($h, $DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$r, [System.Runtime.InteropServices.Marshal]::SizeOf([type][RECT]))
    if ($ok -ne 0) { [WinAPI]::GetWindowRect($h, [ref]$r) | Out-Null }
  } catch {
    [WinAPI]::GetWindowRect($h, [ref]$r) | Out-Null
  }
  return $r
}

function Get-FrameOffset([IntPtr]$h) {
  # اختلاف بین کادر واقعی پنجره (GetWindowRect، شاملِ سایهٔ نامرئی) و کادر دیداری (DWM) —
  # برای این‌که وقتی SetWindowPos صدا می‌زنیم، لبهٔ *دیداری* پنجره دقیقاً با چیدمان ما یکی باشد.
  $raw = New-Object RECT
  [WinAPI]::GetWindowRect($h, [ref]$raw) | Out-Null
  $ext = Get-ExtendedRect $h
  return @{
    left = $ext.Left - $raw.Left; top = $ext.Top - $raw.Top
    right = $raw.Right - $ext.Right; bottom = $raw.Bottom - $ext.Bottom
  }
}

function Is-Cloaked([IntPtr]$h) {
  try {
    $v = 0
    $ok = [WinAPI]::DwmGetWindowAttributeInt($h, $DWMWA_CLOAKED, [ref]$v, 4)
    return ($ok -eq 0 -and $v -ne 0)
  } catch {
    return $false
  }
}

function Get-IconBase64([string]$exePath) {
  try {
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
    if (-not $icon) { return $null }
    $bmp = $icon.ToBitmap()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return [Convert]::ToBase64String($ms.ToArray())
  } catch { return $null }
}

function Get-WindowInfo([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [WinAPI]::GetWindowText($h, $sb, 512) | Out-Null
  $title = $sb.ToString()
  $pid = 0
  [WinAPI]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
  $procName = ''; $exePath = ''
  try {
    $p = Get-Process -Id $pid -ErrorAction Stop
    $procName = $p.ProcessName
    try { $exePath = $p.MainModule.FileName } catch { $exePath = '' }
  } catch {}
  $rect = Get-ExtendedRect $h
  [PSCustomObject]@{
    handle   = [int64]$h
    title    = $title
    pid      = $pid
    process  = $procName
    exePath  = $exePath
    x        = $rect.Left
    y        = $rect.Top
    w        = ($rect.Right - $rect.Left)
    h        = ($rect.Bottom - $rect.Top)
    maximized = [bool][WinAPI]::IsZoomed($h)
    minimized = [bool][WinAPI]::IsIconic($h)
    icon     = (Get-IconBase64 $exePath)
  }
}

function Cmd-List {
  $results = New-Object System.Collections.Generic.List[object]
  $selfPid = $PID
  $dbg = @{ seen = 0; afterVisible = 0; afterOwner = 0; afterTool = 0; afterCloak = 0; afterTitle = 0; afterClass = 0; errors = New-Object System.Collections.Generic.List[string] }

  $enumProc = {
    param([IntPtr]$h, [IntPtr]$lp)
    try {
      $dbg.seen++
      if (-not [WinAPI]::IsWindowVisible($h)) { return $true }
      $dbg.afterVisible++
      if ([WinAPI]::GetWindow($h, $GW_OWNER) -ne [IntPtr]::Zero) { return $true }
      $dbg.afterOwner++
      $ex = [WinAPI]::GetWindowLong($h, $GWL_EXSTYLE)
      if (($ex -band $WS_EX_TOOLWINDOW) -ne 0) { return $true }
      $dbg.afterTool++
      if (Is-Cloaked $h) { return $true }
      $dbg.afterCloak++
      $len = [WinAPI]::GetWindowTextLength($h)
      if ($len -eq 0) { return $true }
      $dbg.afterTitle++
      $cls = New-Object System.Text.StringBuilder 256
      [WinAPI]::GetClassName($h, $cls, 256) | Out-Null
      $className = $cls.ToString()
      $blacklist = @('Progman', 'Button', 'Shell_TrayWnd', 'WorkerW', 'Windows.UI.Core.CoreWindow', 'ApplicationManager_DesktopShellWindow')
      if ($blacklist -contains $className) { return $true }
      $dbg.afterClass++
      $info = Get-WindowInfo $h
      if ($info.pid -eq $selfPid) { return $true }
      if ([string]::IsNullOrWhiteSpace($info.title)) { return $true }
      $results.Add($info)
    } catch {
      $dbg.errors.Add($_.Exception.Message)
    }
    return $true
  }

  # نگه‌داشتنِ ارجاع صریح به Delegate تا پیش از پایانِ EnumWindows توسطِ GC جمع‌آوری نشود.
  $delegate = [WinAPI+EnumWindowsProc]$enumProc
  [WinAPI]::EnumWindows($delegate, [IntPtr]::Zero) | Out-Null

  # اگر فیلترها همه‌چیز را حذف کردند ولی پنجره‌ای واقعاً دیده شده، نسخهٔ سخت‌گیرانه‌تر را کنار می‌گذاریم
  # و یک تلاش دومِ «نرم‌گیرانه» (فقط دیداپذیر + عنوان غیرخالی + بدون مالک) انجام می‌دهیم.
  if ($results.Count -eq 0 -and $dbg.seen -gt 0) {
    $fallback = New-Object System.Collections.Generic.List[object]
    $enumProc2 = {
      param([IntPtr]$h, [IntPtr]$lp)
      try {
        if (-not [WinAPI]::IsWindowVisible($h)) { return $true }
        if ([WinAPI]::GetWindow($h, $GW_OWNER) -ne [IntPtr]::Zero) { return $true }
        $len = [WinAPI]::GetWindowTextLength($h)
        if ($len -eq 0) { return $true }
        $info = Get-WindowInfo $h
        if ($info.pid -eq $selfPid) { return $true }
        if ([string]::IsNullOrWhiteSpace($info.title)) { return $true }
        $fallback.Add($info)
      } catch {}
      return $true
    }
    $delegate2 = [WinAPI+EnumWindowsProc]$enumProc2
    [WinAPI]::EnumWindows($delegate2, [IntPtr]::Zero) | Out-Null
    if ($fallback.Count -gt 0) {
      return @{ ok = $true; windows = $fallback; debug = $dbg; usedFallback = $true }
    }
  }

  return @{ ok = $true; windows = $results; debug = $dbg }
}

function Cmd-Rect {
  $h = [IntPtr][int64]$Handle
  return @{ ok = $true; window = (Get-WindowInfo $h) }
}

function Cmd-Move {
  # BatchFile: مسیر یک فایل JSON شامل [{"handle":123,"x":0,"y":0,"w":800,"h":600}, ...]
  $raw = Get-Content -LiteralPath $BatchFile -Raw -Encoding UTF8
  $items = $raw | ConvertFrom-Json
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($it in $items) {
    try {
      $h = [IntPtr][int64]$it.handle
      if ([WinAPI]::IsIconic($h)) { [WinAPI]::ShowWindow($h, $SW_RESTORE) | Out-Null }
      if ([WinAPI]::IsZoomed($h)) { [WinAPI]::ShowWindow($h, $SW_RESTORE) | Out-Null }
      Start-Sleep -Milliseconds 20
      $off = Get-FrameOffset $h
      $nx = [int]$it.x - [int]$off.left
      $ny = [int]$it.y - [int]$off.top
      $nw = [int]$it.w + [int]$off.left + [int]$off.right
      $nh = [int]$it.h + [int]$off.top + [int]$off.bottom
      $ok = [WinAPI]::SetWindowPos($h, $HWND_TOP, $nx, $ny, $nw, $nh, $SWP_SHOWWINDOW)
      $out.Add(@{ handle = $it.handle; ok = [bool]$ok })
    } catch {
      $out.Add(@{ handle = $it.handle; ok = $false; error = $_.Exception.Message })
    }
  }
  return @{ ok = $true; results = $out }
}

function Cmd-Zoom {
  Add-Type -AssemblyName System.Windows.Forms
  $h = [IntPtr][int64]$Handle
  [WinAPI]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 180
  [System.Windows.Forms.SendKeys]::SendWait('^0')
  Start-Sleep -Milliseconds 120
  if ($Steps -lt 0) {
    for ($i = 0; $i -lt [Math]::Abs($Steps); $i++) {
      [System.Windows.Forms.SendKeys]::SendWait('^{-}')
      Start-Sleep -Milliseconds 70
    }
  } elseif ($Steps -gt 0) {
    for ($i = 0; $i -lt $Steps; $i++) {
      [System.Windows.Forms.SendKeys]::SendWait('^{+}')
      Start-Sleep -Milliseconds 70
    }
  }
  return @{ ok = $true }
}

function Cmd-Focus {
  $h = [IntPtr][int64]$Handle
  $ok = [WinAPI]::SetForegroundWindow($h)
  return @{ ok = [bool]$ok }
}

try {
  switch ($Cmd) {
    'list'  { $r = Cmd-List }
    'rect'  { $r = Cmd-Rect }
    'move'  { $r = Cmd-Move }
    'zoom'  { $r = Cmd-Zoom }
    'focus' { $r = Cmd-Focus }
  }
  $r | ConvertTo-Json -Depth 6 -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
