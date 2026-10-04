using System.Drawing;
using System.Windows.Forms;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WinMirror;

/// <summary>
/// پازل‌تب — WinMirror.exe
/// یک ابزار کمکیِ کوچکِ بومی ویندوز که پنجرهٔ واقعیِ یک برنامه (مثلاً Chrome) را خارج از صفحه «پارک»
/// می‌کند (در اندازهٔ ثابتِ مرجع ۱۰۰٪) و به‌جایش یک آینهٔ زنده (DWM Thumbnail) در جایی که کاربر
/// می‌خواهد نشان می‌دهد؛ کلیک/اسکرول/تایپ در آینه به پنجرهٔ واقعیِ پنهان هدایت می‌شود.
/// پروتکل: هر خط از stdin یک دستور JSON، هر خط از stdout یک پاسخ/رویداد JSON است.
/// </summary>
static class Program
{
    static readonly Dictionary<int, MirrorForm> Mirrors = new();
    static readonly object Lock = new();
    static SynchronizationContext? _uiCtx;

    [STAThread]
    static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using var ctx = new ApplicationContext();
        _uiCtx = new WindowsFormsSynchronizationContext();
        SynchronizationContext.SetSynchronizationContext(_uiCtx);

        var stdinThread = new Thread(ReadStdinLoop) { IsBackground = true };
        stdinThread.Start();

        Emit(new { ok = true, @event = "ready" });
        Application.Run(ctx);
    }

    static void ReadStdinLoop()
    {
        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            var text = line;
            if (string.IsNullOrWhiteSpace(text)) continue;
            _uiCtx!.Post(_ => HandleLine(text), null);
        }
        // stdin بسته شد یعنی Node (Electron) دیگر زنده نیست — همه‌چیز را پاک‌سازی و خروج کن
        _uiCtx!.Post(_ => { RestoreAllAndExit(); }, null);
    }

    static void HandleLine(string line)
    {
        JsonElement cmdEl;
        try
        {
            using var doc = JsonDocument.Parse(line);
            cmdEl = doc.RootElement.Clone();
        }
        catch (Exception ex)
        {
            Emit(new { ok = false, error = "bad json: " + ex.Message });
            return;
        }
        try { Dispatch(cmdEl); }
        catch (Exception ex) { Emit(new { ok = false, error = ex.Message }); }
    }

    static void Dispatch(JsonElement cmd)
    {
        string cmdName = cmd.GetProperty("cmd").GetString() ?? "";
        switch (cmdName)
        {
            case "ping": Emit(new { ok = true, pong = true }); break;
            case "create": CmdCreate(cmd); break;
            case "move": CmdMove(cmd); break;
            case "setAccent": CmdSetAccent(cmd); break;
            case "destroy": CmdDestroy(cmd); break;
            case "list": CmdList(); break;
            case "shutdown": RestoreAllAndExit(); break;
            default: Emit(new { ok = false, error = "unknown cmd: " + cmdName }); break;
        }
    }

    const int PARK_X = -32000;
    const int PARK_Y = 0;
    const int PARK_W = 1440;
    const int PARK_H = 900;

    static void CmdCreate(JsonElement cmd)
    {
        int id = cmd.GetProperty("id").GetInt32();
        long sourceHandle = cmd.GetProperty("source").GetInt64();
        int x = cmd.GetProperty("x").GetInt32();
        int y = cmd.GetProperty("y").GetInt32();
        int w = cmd.GetProperty("w").GetInt32();
        int h = cmd.GetProperty("h").GetInt32();
        string proc = cmd.TryGetProperty("process", out var pEl) ? (pEl.GetString() ?? "") : "";
        IntPtr src = new IntPtr(sourceHandle);

        if (!Native.IsWindow(src)) { Emit(new { ok = false, id, error = "source window not found" }); return; }

        Native.GetWindowRect(src, out var originalRect);

        // پارک‌کردن پنجرهٔ واقعی خارج از صفحه، در اندازهٔ ثابتِ مرجع (۱۰۰٪) — از این به بعد دیگر
        // هیچ‌وقت لازم نیست اندازه‌اش را تغییر بدهیم؛ فقط آینه (مقصد) تغییر اندازه می‌دهد.
        if (Native.IsIconic(src)) Native.ShowWindow(src, Native.SW_RESTORE);
        Native.SetWindowPos(src, Native.HWND_BOTTOM, PARK_X, PARK_Y, PARK_W, PARK_H, Native.SWP_NOACTIVATE);

        var form = new MirrorForm(id, src, originalRect, proc);
        form.SetDesktopBounds(x, y, Math.Max(120, w), Math.Max(80, h));
        form.Show();
        form.RegisterThumb();

        lock (Lock) { Mirrors[id] = form; }
        Emit(new { ok = true, id, @event = "created" });
    }

    static void CmdMove(JsonElement cmd)
    {
        int id = cmd.GetProperty("id").GetInt32();
        lock (Lock)
        {
            if (!Mirrors.TryGetValue(id, out var form)) { Emit(new { ok = false, id, error = "no such mirror" }); return; }
            int x = cmd.GetProperty("x").GetInt32();
            int y = cmd.GetProperty("y").GetInt32();
            int w = cmd.GetProperty("w").GetInt32();
            int h = cmd.GetProperty("h").GetInt32();
            form.SetDesktopBounds(x, y, Math.Max(120, w), Math.Max(80, h));
        }
        Emit(new { ok = true, id });
    }

    static void CmdSetAccent(JsonElement cmd)
    {
        int id = cmd.GetProperty("id").GetInt32();
        string hex = cmd.GetProperty("color").GetString() ?? "#0078d4";
        lock (Lock)
        {
            if (!Mirrors.TryGetValue(id, out var form)) { Emit(new { ok = false, id, error = "no such mirror" }); return; }
            try
            {
                var c = System.Drawing.ColorTranslator.FromHtml(hex);
                form.SetAccent(c);
            }
            catch { }
        }
        Emit(new { ok = true, id });
    }

    static void CmdDestroy(JsonElement cmd)
    {
        int id = cmd.GetProperty("id").GetInt32();
        bool restore = !cmd.TryGetProperty("restore", out var rEl) || rEl.GetBoolean();
        MirrorForm? form;
        lock (Lock) { Mirrors.Remove(id, out form); }
        if (form == null) { Emit(new { ok = false, id, error = "no such mirror" }); return; }

        if (restore && Native.IsWindow(form.SourceHandle))
        {
            var r = form.OriginalRect;
            Native.SetWindowPos(form.SourceHandle, Native.HWND_TOP, r.Left, r.Top, r.W, r.H, 0);
            Native.ShowWindow(form.SourceHandle, Native.SW_RESTORE);
            Native.SetForegroundWindow(form.SourceHandle);
        }
        form.Close();
        form.Dispose();
        Emit(new { ok = true, id, @event = "destroyed" });
    }

    static void CmdList()
    {
        lock (Lock)
        {
            var arr = Mirrors.Values.Select(f => new { id = f.MirrorId, source = (long)f.SourceHandle, process = f.ProcessName }).ToArray();
            Emit(new { ok = true, mirrors = arr });
        }
    }

    public static void ReportMoved(MirrorForm f)
    {
        Emit(new { @event = "moved", id = f.MirrorId, x = f.DesktopLocation.X, y = f.DesktopLocation.Y, w = f.Width, h = f.Height });
    }

    public static void ReportSourceLost(MirrorForm f)
    {
        lock (Lock) { Mirrors.Remove(f.MirrorId); }
        Emit(new { @event = "sourceLost", id = f.MirrorId });
    }

    public static void ReportWantsRestore(MirrorForm f)
    {
        Emit(new { @event = "wantsRestore", id = f.MirrorId });
    }

    static void RestoreAllAndExit()
    {
        lock (Lock)
        {
            foreach (var kv in Mirrors.ToArray())
            {
                var form = kv.Value;
                if (Native.IsWindow(form.SourceHandle))
                {
                    var r = form.OriginalRect;
                    Native.SetWindowPos(form.SourceHandle, Native.HWND_TOP, r.Left, r.Top, r.W, r.H, 0);
                    Native.ShowWindow(form.SourceHandle, Native.SW_RESTORE);
                }
                form.Close();
            }
            Mirrors.Clear();
        }
        Emit(new { @event = "shutdown-complete" });
        Application.Exit();
    }

    static readonly object EmitLock = new();
    static void Emit(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        lock (EmitLock) { Console.WriteLine(json); Console.Out.Flush(); }
    }
}

static class FormExtensions
{
    public static void SetDesktopBounds(this Form f, int x, int y, int w, int h)
    {
        f.StartPosition = FormStartPosition.Manual;
        f.DesktopBounds = new Rectangle(x, y, w, h);
    }
}
