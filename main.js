'use strict'
/* پازل‌تب — PuzzleTab
 * پنجرهٔ اصلی: فریم بومی ویندوز ۱۱ + پس‌زمینهٔ Mica + میانبر سراسری Ctrl+Alt+P
 */

const { app, BrowserWindow, ipcMain, shell, nativeTheme, systemPreferences, globalShortcut, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const IS_SELFTEST = process.argv.includes('--selftest')

let win = null

/* ---------- مدیریت webview های مهمان (هر کاشی = نشست مجزا) ----------
 * - پنجره‌های جدید (target=_blank / window.open) در مرورگر پیش‌فرض باز می‌شوند
 *   تا کاربر داخل اپ گیر پنجرهٔ ناخواسته نیفتد.
 * - مجوزهای رایج (نوتیفیکیشن، میکروفون/دوربین برای تماس، کلیپ‌بورد) پیش‌فرض مجاز
 *   می‌شوند چون کاربر خودش سایت‌های مورد اعتمادش را اضافه می‌کند (تلگرام/دیسکورد/...).
 */
const ALLOWED_PERMISSIONS = new Set([
  'notifications', 'media', 'clipboard-sanitized-write', 'clipboard-read',
  'fullscreen', 'pointerLock', 'background-sync', 'display-capture'
])

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  try {
    contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission))
    })
  } catch (_) { /* ignore */ }
})

ipcMain.handle('tile:clear-session', async (_e, partition) => {
  if (typeof partition !== 'string' || !partition) return false
  try {
    const ses = session.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
    return true
  } catch (e) {
    console.error('[clear-session] failed:', e.message)
    return false
  }
})

/* ---------- ویندوز ۱۱؟ (بیلد >= 22000) ---------- */
function isWin11 () {
  if (process.platform !== 'win32') return false
  const parts = String(os.release() || '').split('.')
  return Number(parts[2] || 0) >= 22000
}
const WIN11 = isWin11()

/* ---------- رنگ اکسنت ویندوز ---------- */
function accentColor () {
  try {
    let c = String(systemPreferences.getAccentColor() || '')
    if (/^#[0-9a-f]{8}$/i.test(c)) c = '#' + c.slice(3) /* ARGB → RGB */
    if (/^#[0-9a-f]{6}$/i.test(c)) return c
  } catch (_) { /* ignore */ }
  return '#0078d4' /* اکسنت پیش‌فرض ویندوز ۱۱ */
}

function sysInfo () {
  return {
    dark: nativeTheme.shouldUseDarkColors,
    accent: accentColor(),
    win11: WIN11,
    platform: process.platform
  }
}

/* ---------- ذخیره‌سازی (JSON در userData) ---------- */
function storePath () {
  return path.join(app.getPath('userData'), 'store.json')
}

function loadStore () {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'))
  } catch (_) {
    return null
  }
}

function saveStore (data) {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    fs.writeFileSync(storePath(), JSON.stringify(data, null, 1), 'utf8')
    return true
  } catch (e) {
    console.error('[store] save failed:', e.message)
    return false
  }
}

/* ---------- ساخت پنجره ---------- */
function createWindow () {
  const opts = {
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'پازل‌تب — PuzzleTab',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  }

  if (WIN11) {
    /* افکت Mica ویندوز ۱۱ — پس‌زمینهٔ صفحه باید نیمه‌شفاف باشد */
    opts.backgroundMaterial = 'mica'
  } else {
    opts.backgroundColor = nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3'
  }

  win = new BrowserWindow(opts)
  win.loadFile(
    path.join(__dirname, 'renderer', 'index.html'),
    IS_SELFTEST ? { search: 'test=1' } : undefined
  )
  win.once('ready-to-show', () => win.show())

  win.webContents.on('console-message', (...args) => {
    /* سازگار با امضاهای جدید و قدیم (رویداد جدید: event.message) */
    for (const a of args) {
      if (a && typeof a === 'object' && typeof a.message === 'string') {
        if (a.message) console.log('[ui]', a.message)
        return
      }
    }
    const msg = args.find(x => typeof x === 'string' && x)
    if (msg) console.log('[ui]', msg)
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[ui] renderer gone:', details && details.reason)
  })

  return win
}

/* ---------- IPC ---------- */
ipcMain.handle('sys:info', () => sysInfo())
ipcMain.handle('store:load', () => loadStore())
ipcMain.handle('store:save', (_e, data) => saveStore(data))
ipcMain.handle('shell:open', (_e, url) => {
  if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url)
})
ipcMain.handle('win:aot', (_e, value) => {
  if (win) win.setAlwaysOnTop(!!value)
  return !!value
})

nativeTheme.on('updated', () => {
  if (win) win.webContents.send('sys:theme', sysInfo())
})

/* ---------- تست خودکار (برای توسعه) ---------- */
async function runSelfTest () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const killer = setTimeout(() => {
    console.error('SELFTEST_TIMEOUT')
    app.exit(2)
  }, 150000)

  const w = createWindow()
  await new Promise((res) => w.webContents.once('did-finish-load', res))
  await sleep(1200)

  const ex = (code) => w.webContents.executeJavaScript(code)
  const probe = (label, hue) =>
    'file://' + path.join(__dirname, 'renderer', 'probe.html') + '?label=' + label + '&hue=' + hue

  console.log('SELFTEST: adding tiles...')
  await ex(`window.__test.addTile(${JSON.stringify(probe('A', 215))}, { x: 16, y: 16, w: 560, h: 400, vw: 1280 })`)
  await ex(`window.__test.addTile(${JSON.stringify(probe('B', 150))}, { x: 600, y: 16, w: 420, h: 300, vw: 1280 })`)
  await ex(`window.__test.addTile("https://example.com/", { x: 560, y: 300, w: 420, h: 320, vw: 1280 })`)
  await sleep(9000)

  const shot = async (name) => {
    const img = await w.webContents.capturePage()
    fs.writeFileSync(path.join(__dirname, name), img.toPNG())
    console.log('SELFTEST: saved', name, JSON.stringify(img.getSize()))
  }
  await shot('selftest-1.png')

  /* منو روی صفحه (تست چیدمان لایه‌ها روی webview) */
  await ex('window.__test.openMenu()')
  await sleep(500)
  await shot('selftest-2.png')
  await ex('window.__test.closeMenu()')

  /* تست درگ شبیه‌سازی‌شده */
  const drag = await ex(`(async () => {
    const info = window.__test.info()
    const c = window.__test.canvasRect()
    const t = info[0]
    const sel = '.tile[data-id="' + t.id + '"] .tile-drag'
    const hx = c.left + t.x + 60, hy = c.top + t.y + 20
    window.__test.pointer(sel, 'pointerdown', hx, hy)
    window.__test.pointer('body', 'pointermove', hx + 64, hy + 32)
    window.__test.pointer('body', 'pointermove', hx + 64, hy + 32)
    window.__test.pointer('body', 'pointerup', hx + 64, hy + 32)
    await new Promise(r => setTimeout(r, 150))
    return { before: t, after: window.__test.info()[0] }
  })()`)
  console.log('SELFTEST DRAG:', JSON.stringify(drag))

  /* تست تغییر اندازه */
  const resize = await ex(`(async () => {
    const info = window.__test.info()
    const c = window.__test.canvasRect()
    const t = info[1]
    const sel = '.tile[data-id="' + t.id + '"] .rz.se'
    const hx = c.left + t.x + t.w - 4, hy = c.top + t.y + t.h - 4
    window.__test.pointer(sel, 'pointerdown', hx, hy)
    window.__test.pointer('body', 'pointermove', hx + 48, hy + 64)
    window.__test.pointer('body', 'pointerup', hx + 48, hy + 64)
    await new Promise(r => setTimeout(r, 200))
    return { before: t, after: window.__test.info()[1] }
  })()`)
  console.log('SELFTEST RESIZE:', JSON.stringify(resize))

  /* چیدمان خودکار ۲ ستونه */
  await ex('window.__test.arrange(2)')
  await sleep(700)
  await shot('selftest-3.png')

  /* عرض مجازی دیدگاه مهمان‌ها (باید ~1280 باشد) */
  const viewports = await ex('window.__test.viewports()')
  console.log('SELFTEST VIEWPORTS:', JSON.stringify(viewports))
  console.log('SELFTEST INFO:', await ex('JSON.stringify(window.__test.info())'))

  /* تست ماندگاری: رفرش صفحه و بازیابی کاشی‌ها */
  w.webContents.reload()
  await new Promise((res) => w.webContents.once('did-finish-load', res))
  await sleep(2500)
  const afterReload = await ex('JSON.stringify(window.__test.info())')
  console.log('SELFTEST AFTER RELOAD:', afterReload)

  console.log('SELFTEST_DONE')
  clearTimeout(killer)
  app.exit(0)
}

/* ---------- چرخهٔ حیات برنامه ---------- */
const gotLock = IS_SELFTEST || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    if (IS_SELFTEST) {
      try {
        await runSelfTest()
      } catch (e) {
        console.error('SELFTEST_FAILED:', e && (e.stack || e.message || e))
        app.exit(1)
      }
      return
    }

    createWindow()

    /* میانبر سراسری: نمایش/مخفی‌کردن سریع پنجره */
    try {
      globalShortcut.register('Control+Alt+P', () => {
        if (!win) return
        if (win.isVisible() && win.isFocused()) win.hide()
        else {
          win.show()
          win.focus()
        }
      })
    } catch (_) { /* ignore */ }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
}
