using System.Runtime.InteropServices;

namespace WinMirror;

[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left, Top, Right, Bottom; public int W => Right - Left; public int H => Bottom - Top; }

[StructLayout(LayoutKind.Sequential)]
public struct POINT { public int X, Y; }

[StructLayout(LayoutKind.Sequential)]
public struct DWM_THUMBNAIL_PROPERTIES
{
    public int dwFlags;
    public RECT rcDestination;
    public RECT rcSource;
    public byte opacity;
    [MarshalAs(UnmanagedType.Bool)] public bool fVisible;
    [MarshalAs(UnmanagedType.Bool)] public bool fSourceClientAreaOnly;
}

[StructLayout(LayoutKind.Sequential)]
struct INPUT { public uint type; public InputUnion U; }

[StructLayout(LayoutKind.Explicit)]
struct InputUnion
{
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
}

[StructLayout(LayoutKind.Sequential)]
struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

[StructLayout(LayoutKind.Sequential)]
struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

public static class Native
{
    public const int DWM_TNP_RECTDESTINATION = 0x1;
    public const int DWM_TNP_RECTSOURCE = 0x2;
    public const int DWM_TNP_OPACITY = 0x4;
    public const int DWM_TNP_VISIBLE = 0x8;
    public const int DWM_TNP_SOURCECLIENTAREAONLY = 0x10;

    public const uint WM_MOUSEMOVE = 0x0200;
    public const uint WM_LBUTTONDOWN = 0x0201;
    public const uint WM_LBUTTONUP = 0x0202;
    public const uint WM_LBUTTONDBLCLK = 0x0203;
    public const uint WM_RBUTTONDOWN = 0x0204;
    public const uint WM_RBUTTONUP = 0x0205;
    public const uint WM_MOUSEWHEEL = 0x020A;
    public const uint MK_LBUTTON = 0x0001;
    public const uint MK_RBUTTON = 0x0002;

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_SCANCODE = 0x0008;

    public const int SW_RESTORE = 9;
    public const int SW_SHOWNOACTIVATE = 4;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_NOZORDER = 0x0004;
    public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
    public static readonly IntPtr HWND_TOP = IntPtr.Zero;

    // برای «پارکِ نامرئیِ روی صفحه» به‌جایِ خارج‌کردنِ کامل از مرزهای مانیتور: برنامه‌های
    // شتاب‌دهی‌شده با GPU (Chromium/Electron/Qt-ANGLE مثلِ VSCode و تلگرام) وقتی پنجره کاملاً
    // بیرون از همهٔ مانیتورها باشد، آن را «occluded/نامرئی» تشخیص می‌دهند و رندر را متوقف می‌کنند
    // (باعثِ سفیدشدنِ آینه می‌شود). راه‌حل: پنجره را روی مانیتورِ واقعی نگه می‌داریم ولی با
    // WS_EX_LAYERED + آلفای صفر «نامرئی» و با WS_EX_TRANSPARENT «کلیک‌ناپذیر» می‌کنیم — از نظرِ
    // خودِ برنامه، پنجره هنوز کاملاً «روی صفحه و دیده‌شدنی» است، فقط کاربر چیزی نمی‌بیند.
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_LAYERED = 0x80000;
    public const int WS_EX_TRANSPARENT = 0x20;
    public const uint LWA_ALPHA = 0x2;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint crKey, byte bAlpha, uint dwFlags);

    [DllImport("dwmapi.dll")] public static extern int DwmRegisterThumbnail(IntPtr dest, IntPtr src, out IntPtr thumb);
    [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr thumb);
    [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr thumb, ref DWM_THUMBNAIL_PROPERTIES props);
    [DllImport("dwmapi.dll")] public static extern int DwmQueryThumbnailSourceSize(IntPtr thumb, out POINT size);

    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public static IntPtr MakeLParam(int x, int y) => (IntPtr)((y << 16) | (x & 0xFFFF));

    public static void SendUnicodeChar(char c)
    {
        var inputs = new INPUT[2];
        inputs[0] = new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = IntPtr.Zero } } };
        inputs[1] = new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero } } };
        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void SendVkKey(ushort vk, bool keyUp)
    {
        var inputs = new INPUT[1];
        inputs[0] = new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = keyUp ? KEYEVENTF_KEYUP : 0, time = 0, dwExtraInfo = IntPtr.Zero } } };
        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}
