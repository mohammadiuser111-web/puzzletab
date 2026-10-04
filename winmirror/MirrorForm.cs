using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace WinMirror;

/// <summary>
/// یک پنجرهٔ بدون‌قاب که نمایی زنده (DWM Thumbnail) از یک پنجرهٔ واقعیِ دیگر (که جایی خارج از صفحه
/// «پارک» شده) را نشان می‌دهد. کل محتوای داخلی عیناً مثل یک عکسِ کوچک‌شده مقیاس می‌شود — هیچ ریفلو/
/// واکنش‌گرایی رخ نمی‌دهد چون پنجرهٔ واقعی همیشه در اندازهٔ ثابتِ «۱۰۰٪» رندر می‌شود.
/// یک کادر نازک (۸ پیکسل) دور لبه برای جابه‌جایی/تغییراندازهٔ خودِ کادر رزرو شده؛ باقی سطح، کلیک/تایپ
/// را به پنجرهٔ واقعی (که پنهان است) هدایت می‌کند.
/// </summary>
public class MirrorForm : Form
{
    public int MirrorId { get; }
    public IntPtr SourceHandle { get; private set; }
    public RECT OriginalRect { get; set; }
    public string ProcessName { get; set; } = "";

    const int BORDER = 8;
    const int RESIZE_EDGE = 4; // اولین ۴ پیکسل لبه: تغییر اندازه؛ ۴ پیکسل بعدی: جابه‌جایی (HTCAPTION)

    IntPtr _thumb = IntPtr.Zero;
    bool _focused;
    Color _accent = Color.FromArgb(0, 120, 212);
    System.Windows.Forms.Timer? _watchdog;

    public MirrorForm(int id, IntPtr source, RECT originalRect, string processName)
    {
        MirrorId = id;
        SourceHandle = source;
        OriginalRect = originalRect;
        ProcessName = processName;

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        BackColor = Color.Black;
        DoubleBuffered = true;
        KeyPreview = true;
        StartPosition = FormStartPosition.Manual;
        MinimumSize = new Size(120, 80);

        MouseDown += OnMouseDown;
        MouseUp += OnMouseUp;
        MouseMove += OnMouseMove;
        MouseWheel += OnMouseWheel;
        MouseDoubleClick += OnBorderDoubleClick;
        KeyDown += OnKeyDown;
        KeyUp += OnKeyUp;
        KeyPress += OnKeyPress;
        Enter += (_, __) => { _focused = true; Invalidate(); };
        Leave += (_, __) => { _focused = false; Invalidate(); };
        Paint += OnPaint;
        Resize += (_, __) => UpdateThumbRect();
        Move += (_, __) => Program.ReportMoved(this);
        FormClosed += (_, __) => { StopWatchdog(); UnregisterThumb(); };
    }

    public void SetAccent(Color c) { _accent = c; Invalidate(); }

    public void RegisterThumb()
    {
        if (_thumb != IntPtr.Zero) return;
        int hr = Native.DwmRegisterThumbnail(Handle, SourceHandle, out _thumb);
        if (hr != 0) { _thumb = IntPtr.Zero; return; }
        UpdateThumbRect();
        StartWatchdog();
    }

    void UpdateThumbRect()
    {
        if (_thumb == IntPtr.Zero) return;
        var props = new DWM_THUMBNAIL_PROPERTIES
        {
            dwFlags = Native.DWM_TNP_RECTDESTINATION | Native.DWM_TNP_VISIBLE | Native.DWM_TNP_OPACITY | Native.DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination = new RECT { Left = BORDER, Top = BORDER, Right = Math.Max(BORDER + 1, ClientSize.Width - BORDER), Bottom = Math.Max(BORDER + 1, ClientSize.Height - BORDER) },
            opacity = 255,
            fVisible = true,
            fSourceClientAreaOnly = true
        };
        Native.DwmUpdateThumbnailProperties(_thumb, ref props);
    }

    void UnregisterThumb()
    {
        if (_thumb != IntPtr.Zero) { Native.DwmUnregisterThumbnail(_thumb); _thumb = IntPtr.Zero; }
    }

    void StartWatchdog()
    {
        _watchdog = new System.Windows.Forms.Timer { Interval = 700 };
        _watchdog.Tick += (_, __) =>
        {
            if (!Native.IsWindow(SourceHandle))
            {
                Program.ReportSourceLost(this);
                Close();
            }
        };
        _watchdog.Start();
    }
    void StopWatchdog() { _watchdog?.Stop(); _watchdog = null; }

    RECT GetSourceClientRectSafe()
    {
        Native.GetClientRect(SourceHandle, out var r);
        if (r.W <= 0) r.Right = r.Left + 1;
        if (r.H <= 0) r.Bottom = r.Top + 1;
        return r;
    }

    (int x, int y) ToSourceClient(int localX, int localY)
    {
        var src = GetSourceClientRectSafe();
        int contentW = Math.Max(1, ClientSize.Width - 2 * BORDER);
        int contentH = Math.Max(1, ClientSize.Height - 2 * BORDER);
        double sx = (double)src.W / contentW;
        double sy = (double)src.H / contentH;
        int cx = localX - BORDER;
        int cy = localY - BORDER;
        return ((int)Math.Round(cx * sx), (int)Math.Round(cy * sy));
    }

    bool InContentArea(int localX, int localY) =>
        localX >= BORDER && localY >= BORDER && localX < ClientSize.Width - BORDER && localY < ClientSize.Height - BORDER;

    void OnBorderDoubleClick(object? sender, MouseEventArgs e)
    {
        // دابل‌کلیک روی کادر نازک (نه محتوا) = «بازگردانی پنجره به حالت واقعی/عادی»
        if (!InContentArea(e.X, e.Y)) Program.ReportWantsRestore(this);
    }

    void OnMouseDown(object? sender, MouseEventArgs e)
    {
        if (!InContentArea(e.X, e.Y)) return;
        Focus();
        var (sx, sy) = ToSourceClient(e.X, e.Y);
        var lp = Native.MakeLParam(sx, sy);
        uint msg = e.Button == MouseButtons.Right ? Native.WM_RBUTTONDOWN : Native.WM_LBUTTONDOWN;
        Native.PostMessage(SourceHandle, msg, (IntPtr)Native.MK_LBUTTON, lp);
    }

    void OnMouseUp(object? sender, MouseEventArgs e)
    {
        if (!InContentArea(e.X, e.Y)) return;
        var (sx, sy) = ToSourceClient(e.X, e.Y);
        var lp = Native.MakeLParam(sx, sy);
        uint msg = e.Button == MouseButtons.Right ? Native.WM_RBUTTONUP : Native.WM_LBUTTONUP;
        Native.PostMessage(SourceHandle, msg, IntPtr.Zero, lp);
    }

    void OnMouseMove(object? sender, MouseEventArgs e)
    {
        if (!InContentArea(e.X, e.Y)) return;
        var (sx, sy) = ToSourceClient(e.X, e.Y);
        var lp = Native.MakeLParam(sx, sy);
        Native.PostMessage(SourceHandle, Native.WM_MOUSEMOVE, IntPtr.Zero, lp);
    }

    void OnMouseWheel(object? sender, MouseEventArgs e)
    {
        if (!InContentArea(e.X, e.Y)) return;
        var (sx, sy) = ToSourceClient(e.X, e.Y);
        var pt = new POINT { X = sx, Y = sy };
        Native.ClientToScreen(SourceHandle, ref pt); // WM_MOUSEWHEEL از مختصاتِ صفحه استفاده می‌کند
        var lp = Native.MakeLParam(pt.X, pt.Y);
        var wp = (IntPtr)((e.Delta << 16) & unchecked((int)0xFFFF0000));
        Native.PostMessage(SourceHandle, Native.WM_MOUSEWHEEL, wp, lp);
    }

    bool _sourceIsForeground;
    void EnsureSourceFocused()
    {
        if (_sourceIsForeground) return;
        Native.SetForegroundWindow(SourceHandle);
        _sourceIsForeground = true;
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        _sourceIsForeground = false;
    }

    void OnKeyPress(object? sender, KeyPressEventArgs e)
    {
        if (char.IsControl(e.KeyChar)) return; // کنترل‌ها (Enter/Backspace/Tab) در KeyDown مدیریت می‌شوند
        EnsureSourceFocused();
        Native.SendUnicodeChar(e.KeyChar);
        e.Handled = true;
    }

    static readonly Dictionary<Keys, ushort> SpecialVk = new()
    {
        { Keys.Back, 0x08 }, { Keys.Tab, 0x09 }, { Keys.Enter, 0x0D }, { Keys.Escape, 0x1B },
        { Keys.Space, 0x20 }, { Keys.Left, 0x25 }, { Keys.Up, 0x26 }, { Keys.Right, 0x27 }, { Keys.Down, 0x28 },
        { Keys.Delete, 0x2E }, { Keys.Home, 0x24 }, { Keys.End, 0x23 }, { Keys.PageUp, 0x21 }, { Keys.PageDown, 0x22 }
    };

    void OnKeyDown(object? sender, KeyEventArgs e)
    {
        var baseKey = e.KeyCode;
        bool isLetterOrDigitShortcut = e.Control || e.Alt;
        if (SpecialVk.TryGetValue(baseKey, out var vk) || isLetterOrDigitShortcut)
        {
            EnsureSourceFocused();
            ushort code = SpecialVk.TryGetValue(baseKey, out var v) ? v : (ushort)baseKey;
            Native.SendVkKey(code, false);
            Native.SendVkKey(code, true);
            e.Handled = true;
            e.SuppressKeyPress = true;
        }
    }

    void OnKeyUp(object? sender, KeyEventArgs e) { /* کلیدهای چاپ‌شدنی در KeyPress و ویژه‌ها در KeyDown ارسال شدند */ }

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        // اجازه نده Tab/Arrow توسط خودِ Form مصرف شوند؛ باید به پنجرهٔ واقعی برسند
        return false;
    }
    protected override bool IsInputKey(Keys keyData) => true;

    void OnPaint(object? sender, PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var pen = new Pen(_focused ? _accent : Color.FromArgb(140, _accent), 2);
        var rect = new Rectangle(1, 1, ClientSize.Width - 3, ClientSize.Height - 3);
        g.DrawRectangle(pen, rect);
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_NCHITTEST = 0x0084;
        if (m.Msg == WM_NCHITTEST)
        {
            base.WndProc(ref m);
            int xs = unchecked((short)(long)m.LParam);
            int ys = unchecked((short)((long)m.LParam >> 16));
            var p = PointToClient(new Point(xs, ys));
            int w = ClientSize.Width, h = ClientSize.Height;
            bool nearLeft = p.X < RESIZE_EDGE, nearRight = p.X >= w - RESIZE_EDGE;
            bool nearTop = p.Y < RESIZE_EDGE, nearBottom = p.Y >= h - RESIZE_EDGE;
            bool inBorder = p.X < BORDER || p.Y < BORDER || p.X >= w - BORDER || p.Y >= h - BORDER;

            if (nearTop && nearLeft) m.Result = (IntPtr)13; // HTTOPLEFT
            else if (nearTop && nearRight) m.Result = (IntPtr)14; // HTTOPRIGHT
            else if (nearBottom && nearLeft) m.Result = (IntPtr)16; // HTBOTTOMLEFT
            else if (nearBottom && nearRight) m.Result = (IntPtr)17; // HTBOTTOMRIGHT
            else if (nearTop) m.Result = (IntPtr)12; // HTTOP
            else if (nearBottom) m.Result = (IntPtr)15; // HTBOTTOM
            else if (nearLeft) m.Result = (IntPtr)10; // HTLEFT
            else if (nearRight) m.Result = (IntPtr)11; // HTRIGHT
            else if (inBorder) m.Result = (IntPtr)2; // HTCAPTION (جابه‌جایی)
            else m.Result = (IntPtr)1; // HTCLIENT (محتوا؛ کلیک به پنجرهٔ واقعی هدایت می‌شود)
            return;
        }
        base.WndProc(ref m);
    }
}
