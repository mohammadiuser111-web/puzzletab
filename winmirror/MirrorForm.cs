using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
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

    const int BORDER = 14;
    const int RESIZE_EDGE = 5; // اولین ۵ پیکسلِ لبه: تغییراندازه؛ ۹ پیکسلِ بعدی: جابه‌جایی (HTCAPTION)
    // نکته: قبلاً BORDER=8 و RESIZE_EDGE=4 بود، یعنی فقط ۴ پیکسل برای جابه‌جاییِ کادر باقی می‌ماند —
    // که برای گرفتنِ دقیق با موس خیلی نازک بود و کاربر عملاً نمی‌توانست کادر را جابه‌جا کند
    // (یا به تغییراندازه می‌خورد، یا کلیک به محتوایِ تلگرام فوروارد می‌شد). حالا نوارِ جابه‌جایی
    // به ۹ پیکسل رسیده که گرفتنش با موس واقع‌بینانه‌تر است.

    IntPtr _thumb = IntPtr.Zero;
    bool _focused;
    bool _leftDown, _rightDown; // وضعیتِ فعلیِ دکمه‌های موس — برای گزارشِ درستِ wParam به WM_MOUSEMOVE
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
        MouseLeave += (_, __) => ShowRealCursorIfHidden();
        Paint += OnPaint;
        Resize += (_, __) => UpdateThumbRect();
        Move += (_, __) => Program.ReportMoved(this);
        FormClosed += (_, __) => { ShowRealCursorIfHidden(); StopWatchdog(); UnregisterThumb(); };
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

    // مختصاتِ محلی را به داخلِ ناحیهٔ محتوا «گیره» می‌کند — برای وقتی که کاربر در حینِ یک
    // درگ (دکمهٔ موس پایین)، لحظه‌ای از لبهٔ کادر بیرون می‌زند (مثلاً درگ‌کردنِ اسکرول‌بار یا
    // جابه‌جاییِ موارد تا نزدیکیِ لبه). بدونِ این گیره، آن درگ در پنجرهٔ واقعی «نیمه‌کاره» باقی
    // می‌ماند چون دیگر هیچ WM_MOUSEMOVE/WM_xBUTTONUPـی دریافت نمی‌کند.
    (int x, int y) ClampToContentArea(int localX, int localY)
    {
        int minX = BORDER, minY = BORDER;
        int maxX = Math.Max(BORDER, ClientSize.Width - BORDER - 1);
        int maxY = Math.Max(BORDER, ClientSize.Height - BORDER - 1);
        return (Math.Clamp(localX, minX, maxX), Math.Clamp(localY, minY, maxY));
    }

    IntPtr CurrentButtonFlags() =>
        (IntPtr)((_leftDown ? Native.MK_LBUTTON : 0) | (_rightDown ? Native.MK_RBUTTON : 0));

    void OnBorderDoubleClick(object? sender, MouseEventArgs e)
    {
        // دابل‌کلیک روی کادر نازک (نه محتوا) = «بازگردانی پنجره به حالت واقعی/عادی»
        if (!InContentArea(e.X, e.Y)) Program.ReportWantsRestore(this);
    }

    void OnMouseDown(object? sender, MouseEventArgs e)
    {
        if (!InContentArea(e.X, e.Y)) return;
        Focus();
        // باید پنجرهٔ واقعی را قبل از فرستادنِ خودِ کلیک فعال/فورگراند کنیم، نه فقط موقعِ تایپ —
        // وگرنه کلیک روی فیلدِ متن (برایِ فوکوس‌کردنِ آن) وقتی پنجره هنوز فورگراند نیست به‌درستی
        // پردازش نمی‌شود، و بعداً با اولین کلید هم همان فیلد واقعاً فوکوس ندارد (نمی‌شد تایپ کرد).
        EnsureSourceFocused();
        if (e.Button == MouseButtons.Right) _rightDown = true; else _leftDown = true;
        Capture = true; // تا پایانِ درگ، حتی اگر موس از مرزِ کادر بیرون برود، رویدادها را دریافت کنیم
        UpdateCustomCursor(e.X, e.Y);
        uint msg = e.Button == MouseButtons.Right ? Native.WM_RBUTTONDOWN : Native.WM_LBUTTONDOWN;
        SyncRealCursorToSource(e.X, e.Y);
        var (sx, sy) = ToSourceClient(e.X, e.Y);
        Native.PostMessage(SourceHandle, msg, CurrentButtonFlags(), Native.MakeLParam(sx, sy));
        System.Threading.Thread.Sleep(15); // فرصت برای پردازشِ کلیک (مثلاً بازکردنِ پنلِ گیف) پیش از ادامهٔ رویدادها
    }

    void OnMouseUp(object? sender, MouseEventArgs e)
    {
        bool wasDragging = _leftDown || _rightDown;
        if (!InContentArea(e.X, e.Y) && !wasDragging) return;
        if (e.Button == MouseButtons.Right) _rightDown = false; else _leftDown = false;
        if (!_leftDown && !_rightDown) Capture = false;
        var (cx, cy) = ClampToContentArea(e.X, e.Y);
        UpdateCustomCursor(cx, cy);
        uint msg = e.Button == MouseButtons.Right ? Native.WM_RBUTTONUP : Native.WM_LBUTTONUP;
        SyncRealCursorToSource(cx, cy);
        var (sx, sy) = ToSourceClient(cx, cy);
        Native.PostMessage(SourceHandle, msg, CurrentButtonFlags(), Native.MakeLParam(sx, sy));
    }

    // تلگرام (مثلِ بیشترِ اپ‌هایِ ساخته‌شده با Qt) برای تصمیم‌گیریِ «موس بیرونِ پنل است، پس باید
    // بسته شوم» (مثلِ پنلِ گیف/استیکر)، نه فقط لحظهٔ کلیک بلکه به‌طور پیوسته به موقعیتِ واقعیِ
    // نشانگرِ موسِ کلِ سیستم (GetCursorPos) نگاه می‌کند. چون نشانگرِ واقعیِ کاربر همیشه روی خودِ
    // کادرِ آینه می‌ماند (نه روی پنجرهٔ واقعیِ پارک‌شده که جایِ دیگری از صفحه نشسته)، از دیدِ
    // تلگرام همیشه به‌نظر می‌رسید موس «بیرونِ پنل» است — برای همین پنل بلافاصله بسته می‌شد، حتی
    // اگر فقط لحظهٔ کلیک را همگام می‌کردیم و بعد نشانگر را به آینه برمی‌گرداندیم.
    // راه‌حل: تا وقتی موس داخلِ ناحیهٔ محتوایِ آینه است، نشانگرِ واقعیِ سیستم را مخفی می‌کنیم و
    // به‌جایش خودمان یک نشانگرِ ساختگی را دقیقاً در همان مکانِ محلی رسم می‌کنیم؛ و هم‌زمان، پشتِ
    // صحنه، نشانگرِ واقعیِ سیستم را پیوسته (نه فقط لحظهٔ کلیک) روی مکانِ متناظرش در پنجرهٔ واقعی
    // نگه می‌داریم — طوری که از دیدِ تلگرام، موس همیشه واقعاً «روی خودش» است.
    bool _cursorHidden;
    Point _cursorDrawPos = new Point(-100, -100);

    void HideRealCursorIfVisible()
    {
        if (_cursorHidden) return;
        Cursor.Hide();
        _cursorHidden = true;
    }

    void ShowRealCursorIfHidden()
    {
        if (!_cursorHidden) return;
        Cursor.Show();
        _cursorHidden = false;
        Invalidate(new Rectangle(_cursorDrawPos.X - 2, _cursorDrawPos.Y - 2, 16, 22));
    }

    void UpdateCustomCursor(int localX, int localY)
    {
        HideRealCursorIfVisible();
        var old = _cursorDrawPos;
        _cursorDrawPos = new Point(localX, localY);
        Invalidate(new Rectangle(old.X - 2, old.Y - 2, 16, 22));
        Invalidate(new Rectangle(_cursorDrawPos.X - 2, _cursorDrawPos.Y - 2, 16, 22));
    }

    void SyncRealCursorToSource(int localX, int localY)
    {
        var (sx, sy) = ToSourceClient(localX, localY);
        var pt = new POINT { X = sx, Y = sy };
        Native.ClientToScreen(SourceHandle, ref pt);
        Native.SetCursorPos(pt.X, pt.Y);
    }

    void OnMouseMove(object? sender, MouseEventArgs e)
    {
        bool dragging = _leftDown || _rightDown;
        if (!InContentArea(e.X, e.Y) && !dragging)
        {
            ShowRealCursorIfHidden();
            return;
        }
        var (cx, cy) = dragging ? ClampToContentArea(e.X, e.Y) : (e.X, e.Y);
        UpdateCustomCursor(cx, cy);
        var (sx, sy) = ToSourceClient(cx, cy);
        var lp = Native.MakeLParam(sx, sy);
        Native.PostMessage(SourceHandle, Native.WM_MOUSEMOVE, CurrentButtonFlags(), lp);
        // نشانگرِ واقعیِ سیستم را هم‌زمان با هر حرکت (نه فقط کلیک) روی پنجرهٔ واقعی نگه می‌داریم —
        // چون بسته‌شدنِ پنل‌های تلگرام به‌صورتِ پیوسته، نه فقط لحظهٔ کلیک، چک می‌شود.
        SyncRealCursorToSource(cx, cy);
    }


    void OnMouseWheel(object? sender, MouseEventArgs e)
    {
        if (!InContentArea(e.X, e.Y)) return;
        UpdateCustomCursor(e.X, e.Y);
        var (sx, sy) = ToSourceClient(e.X, e.Y);
        var pt = new POINT { X = sx, Y = sy };
        Native.ClientToScreen(SourceHandle, ref pt); // WM_MOUSEWHEEL از مختصاتِ صفحه استفاده می‌کند
        var lp = Native.MakeLParam(pt.X, pt.Y);
        var wp = (IntPtr)((e.Delta << 16) & unchecked((int)0xFFFF0000));
        Native.SetCursorPos(pt.X, pt.Y);
        Native.PostMessage(SourceHandle, Native.WM_MOUSEWHEEL, wp, lp);
    }

    bool _suppressDeactivateReset;
    void EnsureSourceFocused()
    {
        // اگر پنجرهٔ واقعی همین الان هم فورگراند است، دیگر لازم نیست دوباره SetForegroundWindow
        // را صدا بزنیم — این مهم است چون این فراخوانی خودِ MirrorForm را «غیرفعال» می‌کند (چون یک
        // پنجرهٔ دیگر دارد فورگراند می‌شود)، و اگر این اتفاق در هر کلیک دوباره تکرار شود، باعثِ
        // سوییچِ مداومِ فورگراند بینِ آینه و پنجرهٔ واقعی در هر تک‌کلیک می‌شود — که به‌نوبهٔ خود
        // باعثِ رفتارهایِ عجیب در برنامهٔ مقصد می‌شود (مثلاً بسته‌شدنِ خودکارِ پنل‌های popup به
        // محضِ هر تغییرِ activation، که دقیقاً شبیهِ «باز و بسته شدنِ پنلِ گیف» است).
        if (Native.GetForegroundWindow() == SourceHandle) return;
        _suppressDeactivateReset = true;
        Native.SetForegroundWindow(SourceHandle);
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        // اگر پنجره غیرفعال شود (چه به‌خاطرِ کارِ خودمان، چه واقعاً)، برایِ احتیاط نشانگرِ واقعی را
        // برمی‌گردانیم — وگرنه اگر کاربر با Alt+Tab برود جایِ دیگر، موسِ سیستم مخفی می‌ماند.
        ShowRealCursorIfHidden();
        if (_suppressDeactivateReset)
        {
            // این غیرفعال‌شدن به‌خاطرِ فوکوس‌دادنِ عمدیِ خودِ ما به پنجرهٔ واقعی بود (در
            // EnsureSourceFocused)، نه اینکه کاربر واقعاً جایِ دیگری رفته باشد (Alt+Tab) —
            // پس نباید وضعیتِ درگ/کلیکِ در حالِ انجام را پاک کنیم.
            _suppressDeactivateReset = false;
            return;
        }
        // اگر در حینِ یک درگ، فوکوس را واقعاً از دست بدهیم (مثلاً کاربر Alt+Tab کرد)، وضعیتِ
        // دکمه‌ها را پاک می‌کنیم تا در تعامل‌های بعدی به‌اشتباه «دکمه هنوز پایین است» گزارش نشود.
        _leftDown = false; _rightDown = false; Capture = false;
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

        if (_cursorHidden) DrawCustomCursor(g);
    }

    // چون وقتی موس داخلِ ناحیهٔ محتواست نشانگرِ واقعیِ سیستم را مخفی می‌کنیم (نگاهِ EnsureSourceFocused
    // و SyncRealCursorToSource بالاتر)، باید خودمان یک نشانگرِ جایگزین بکشیم تا کاربر همچنان ببیند
    // موسش کجاست — شکلی مشابهِ پیکانِ معمولیِ ویندوز (سفید با حاشیهٔ مشکی).
    void DrawCustomCursor(Graphics g)
    {
        int x = _cursorDrawPos.X, y = _cursorDrawPos.Y;
        var pts = new[]
        {
            new Point(x, y), new Point(x, y + 13), new Point(x + 3, y + 10),
            new Point(x + 5, y + 15), new Point(x + 7, y + 14), new Point(x + 5, y + 9),
            new Point(x + 9, y + 9)
        };
        using var fill = new SolidBrush(Color.White);
        using var outline = new Pen(Color.Black, 1);
        g.FillPolygon(fill, pts);
        g.DrawPolygon(outline, pts);
    }

    // هنگامِ کشیدنِ لبه/گوشهٔ کادر توسطِ کاربر، اندازهٔ جدید را طوری محدود می‌کنیم که نسبتِ
    // تصویرِ محتوا (عرض به ارتفاعِ ناحیهٔ داخلیِ منهایِ کادر) همیشه با نسبتِ تصویرِ خودِ پنجرهٔ
    // واقعیِ پارک‌شده یکی بماند — در غیرِ این صورت DWM Thumbnail محتوا را غیریکنواخت (فشرده/
    // کِش‌آمده) مقیاس می‌دهد چون طول و عرض را جدا از هم تغییر می‌دهیم.
    void AdjustSizingRect(int edge, IntPtr lParam)
    {
        var src = GetSourceClientRectSafe();
        if (src.W <= 0 || src.H <= 0) return;
        double aspect = (double)src.W / src.H; // عرض/ارتفاعِ محتوا

        var rect = Marshal.PtrToStructure<RECT>(lParam);
        int curW = rect.Right - rect.Left;
        int curH = rect.Bottom - rect.Top;
        int contentW = Math.Max(1, curW - 2 * BORDER);
        int contentH = Math.Max(1, curH - 2 * BORDER);

        const int WMSZ_LEFT = 1, WMSZ_RIGHT = 2, WMSZ_TOPLEFT = 4,
                   WMSZ_TOPRIGHT = 5, WMSZ_BOTTOMLEFT = 7, WMSZ_BOTTOMRIGHT = 8;

        bool deriveHeightFromWidth = edge == WMSZ_LEFT || edge == WMSZ_RIGHT
            || edge == WMSZ_TOPLEFT || edge == WMSZ_TOPRIGHT || edge == WMSZ_BOTTOMLEFT || edge == WMSZ_BOTTOMRIGHT;

        if (deriveHeightFromWidth)
        {
            int newH = (int)Math.Round(contentW / aspect) + 2 * BORDER;
            if (edge == WMSZ_TOPLEFT || edge == WMSZ_TOPRIGHT) rect.Top = rect.Bottom - newH;
            else rect.Bottom = rect.Top + newH;
        }
        else
        {
            int newW = (int)Math.Round(contentH * aspect) + 2 * BORDER;
            rect.Right = rect.Left + newW;
        }

        Marshal.StructureToPtr(rect, lParam, true);
    }

    protected override void WndProc(ref Message m)
    {
        const int WM_SIZING = 0x0214;
        if (m.Msg == WM_SIZING)
        {
            AdjustSizingRect(m.WParam.ToInt32(), m.LParam);
            base.WndProc(ref m);
            return;
        }
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
