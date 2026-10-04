'use strict'
/* پازل‌تب — PuzzleTab (نسخهٔ ۲: ساکن در System Tray، مدیریت واقعیِ پنجره‌های باز ویندوز)
 * بدون پنجرهٔ اصلی/هدر دائمی — همه‌چیز از آیکون کنار ساعت ویندوز کنترل می‌شود.
 */

const { app, BrowserWindow, ipcMain, shell, nativeTheme, systemPreferences, globalShortcut, session, Tray, Menu, screen, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const winctl = require('./winctl')

winctl.init(app)

const IS_SELFTEST = process.argv.includes('--selftest')
const IS_SELFTEST_OVERLAY = process.argv.includes('--selftest-overlay')
const IS_SELFTEST_AUTOSCALE = process.argv.includes('--selftest-autoscale')

let tray = null
let embeddedWin = null /* پنجرهٔ قدیمی: کاشی‌های سایت داخل برنامه */
let pickerWin = null
let overlayWin = null

/* ---------- ویندوز ۱۱؟ ---------- */
function isWin11 () {
  if (process.platform !== 'win32') return false
  const parts = String(os.release() || '').split('.')
  return Number(parts[2] || 0) >= 22000
}
const WIN11 = isWin11()

function accentColor () {
  try {
    let c = String(systemPreferences.getAccentColor() || '')
    if (/^#[0-9a-f]{8}$/i.test(c)) c = '#' + c.slice(3)
    if (/^#[0-9a-f]{6}$/i.test(c)) return c
  } catch (_) {}
  return '#0078d4'
}

function sysInfo () {
  return { dark: nativeTheme.shouldUseDarkColors, accent: accentColor(), win11: WIN11, platform: process.platform, mock: winctl.isMock }
}

/* ================= ذخیره‌سازی (مرج‌شونده، مشترک بین حالت‌ها) ================= */
function storePath () { return path.join(app.getPath('userData'), 'store.json') }
function loadStore () {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')) } catch (_) { return {} }
}
function saveStorePatch (patch) {
  try {
    const cur = loadStore() || {}
    const merged = Object.assign({}, cur, patch)
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    fs.writeFileSync(storePath(), JSON.stringify(merged, null, 1), 'utf8')
    return true
  } catch (e) {
    console.error('[store] save failed:', e.message)
    return false
  }
}

/* ================= webview های حالت «کاشی داخلی» ================= */
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
  } catch (_) {}
})

ipcMain.handle('tile:clear-session', async (_e, partition) => {
  if (typeof partition !== 'string' || !partition) return false
  try {
    const ses = session.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
    return true
  } catch (e) { console.error('[clear-session] failed:', e.message); return false }
})

function createEmbeddedWindow () {
  if (embeddedWin && !embeddedWin.isDestroyed()) { embeddedWin.show(); embeddedWin.focus(); return embeddedWin }
  const opts = {
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    title: 'پازل‌تب — کاشی‌های داخلی',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  }
  if (WIN11) opts.backgroundMaterial = 'mica'
  else opts.backgroundColor = nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3'

  embeddedWin = new BrowserWindow(opts)
  embeddedWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), IS_SELFTEST ? { search: 'test=1' } : undefined)
  embeddedWin.once('ready-to-show', () => embeddedWin.show())
  embeddedWin.webContents.on('console-message', (...args) => {
    for (const a of args) { if (a && typeof a === 'object' && typeof a.message === 'string') { if (a.message) console.log('[ui]', a.message); return } }
    const msg = args.find((x) => typeof x === 'string' && x)
    if (msg) console.log('[ui]', msg)
  })
  embeddedWin.webContents.on('render-process-gone', (_e, details) => console.error('[ui] renderer gone:', details && details.reason))
  embeddedWin.on('closed', () => { embeddedWin = null })
  return embeddedWin
}

/* ================= پنجرهٔ انتخاب‌گر (Picker) ================= */
function createPickerWindow () {
  if (pickerWin && !pickerWin.isDestroyed()) { pickerWin.show(); pickerWin.focus(); return pickerWin }
  const disp = screen.getPrimaryDisplay()
  const w = 440, h = 620
  pickerWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(disp.workArea.x + (disp.workArea.width - w) / 2),
    y: Math.round(disp.workArea.y + (disp.workArea.height - h) / 2),
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    transparent: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  pickerWin.loadFile(path.join(__dirname, 'renderer', 'picker', 'index.html'))
  pickerWin.once('ready-to-show', () => pickerWin.show())
  pickerWin.on('closed', () => { pickerWin = null })
  pickerWin.on('blur', () => { if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close() })
  return pickerWin
}

/* ================= پنجرهٔ روکش (Overlay) — ویرایش زنده چیدمان ================= */
function virtualScreenBounds () {
  const displays = screen.getAllDisplays()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  displays.forEach((d) => {
    minX = Math.min(minX, d.bounds.x)
    minY = Math.min(minY, d.bounds.y)
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width)
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height)
  })
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function createOverlayWindow () {
  if (overlayWin && !overlayWin.isDestroyed()) { overlayWin.show(); overlayWin.focus(); return overlayWin }
  const vb = virtualScreenBounds()
  overlayWin = new BrowserWindow({
    x: vb.x,
    y: vb.y,
    width: vb.width,
    height: vb.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try { overlayWin.setAlwaysOnTop(true, 'pop-up-menu') } catch (_) {}
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay', 'index.html'), IS_SELFTEST_OVERLAY ? { search: 'test=1' } : undefined)
  overlayWin.once('ready-to-show', () => overlayWin.show())
  overlayWin.webContents.on('console-message', (...args) => {
    for (const a of args) { if (a && typeof a === 'object' && typeof a.message === 'string') { if (a.message) console.log('[overlay]', a.message); return } }
  })
  overlayWin.on('closed', () => { overlayWin = null })
  return overlayWin
}

function closeOverlay () { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close() }

/* ================= IPC عمومی ================= */
ipcMain.handle('sys:info', () => sysInfo())
ipcMain.handle('store:load', () => loadStore())
ipcMain.handle('store:save', (_e, data) => saveStorePatch(data))
ipcMain.handle('shell:open', (_e, url) => { if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url) })
ipcMain.handle('win:aot', (_e, value) => { if (embeddedWin) embeddedWin.setAlwaysOnTop(!!value); return !!value })

nativeTheme.on('updated', () => {
  if (embeddedWin) embeddedWin.webContents.send('sys:theme', sysInfo())
  if (overlayWin) overlayWin.webContents.send('sys:theme', sysInfo())
  if (pickerWin) pickerWin.webContents.send('sys:theme', sysInfo())
})

/* ---------- IPC مخصوص کنترل پنجره‌های واقعی ویندوز ---------- */
ipcMain.handle('winctl:list', async () => { try { return await winctl.list() } catch (e) { return { ok: false, error: e.message } } })
ipcMain.handle('winctl:rect', async (_e, handle) => { try { return await winctl.rect(handle) } catch (e) { return { ok: false, error: e.message } } })
ipcMain.handle('winctl:move', async (_e, items) => { try { return await winctl.move(items) } catch (e) { return { ok: false, error: e.message } } })
ipcMain.handle('winctl:zoom', async (_e, handle, steps) => { try { return await winctl.zoom(handle, steps) } catch (e) { return { ok: false, error: e.message } } })
ipcMain.handle('winctl:focus', async (_e, handle) => { try { return await winctl.focus(handle) } catch (e) { return { ok: false, error: e.message } } })
ipcMain.handle('winctl:minimize', async (_e, handle) => { try { return await winctl.minimize(handle) } catch (e) { return { ok: false, error: e.message } } })

ipcMain.handle('managed:load', () => (loadStore() || {}).managed || null)
ipcMain.handle('managed:save', (_e, data) => saveStorePatch({ managed: data }))

ipcMain.handle('screens:bounds', () => ({
  virtual: virtualScreenBounds(),
  displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }))
}))

ipcMain.handle('picker:open', () => createPickerWindow())
ipcMain.handle('overlay:close', () => closeOverlay())
ipcMain.handle('overlay:openWithHandles', (_e, handles) => {
  const ov = createOverlayWindow()
  const send = () => ov.webContents.send('overlay:seed', handles)
  if (ov.webContents.isLoadingMainFrame()) ov.webContents.once('did-finish-load', send)
  else send()
  if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close()
})

/* ================= System Tray ================= */
function trayIconPath () {
  const p = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  return fs.existsSync(p) ? p : path.join(__dirname, 'assets', 'icon.png')
}

/* ================= نگهبان مقیاس خودکار (بدون نیاز به انتخاب، بدون هیچ باکسی) =================
 * منطق: هر چند صدم ثانیه یک‌بار لیست پنجره‌های واقعیِ باز را می‌خوانیم. برای هر پنجره‌ای که
 * متعلق به یکی از دسته‌های «مدیریت‌شده» باشد (مرورگر/ترمینال/سفارشی)، همان لحظهٔ اولی که دیده
 * می‌شود اندازه‌اش را به‌عنوان «مرجع ۱۰۰٪» ثبت می‌کنیم. از آن به بعد، وقتی کاربر با دست (درست
 * مثل هر پنجرهٔ ویندوزی دیگر) لبهٔ آن را می‌کشد و تغییر اندازه می‌دهد، به‌محض این‌که اندازه
 * چند صدم ثانیه «ثابت» بماند (یعنی کشیدن تمام شده)، میزان زوم لازم را محاسبه و به‌صورت نامرئی
 * اعمال می‌کنیم تا طرح‌بندی داخلی صفحه دقیقاً مثل حالت ۱۰۰٪ بماند و فقط کوچک‌تر دیده شود —
 * بدون هیچ پنجره/باکس/انتخابگرِ اضافه روی صفحه. */
const ZOOM_STEPS_TABLE = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]
const ZOOM_100_IDX = ZOOM_STEPS_TABLE.indexOf(100)
function zoomStepsFor (newWidth, refWidth) {
  if (!refWidth || refWidth <= 0) return 0
  const pct = Math.max(25, Math.min(500, (newWidth / refWidth) * 100))
  let best = ZOOM_100_IDX, bestDiff = Infinity
  ZOOM_STEPS_TABLE.forEach((v, idx) => {
    const d = Math.abs(v - pct)
    if (d < bestDiff) { bestDiff = d; best = idx }
  })
  return best - ZOOM_100_IDX
}

function normalizeProc (p) { return String(p || '').toLowerCase().replace(/\.exe$/, '') }

// Process.ProcessName در ویندوز هرگز شامل پسوند .exe نیست (مثلاً "chrome" نه "chrome.exe")
const BROWSER_SET = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'])
const TERMINAL_SET = new Set(['windowsterminal', 'cmd', 'powershell', 'pwsh', 'conhost'])

function loadAutoscaleSettings () {
  const s = (loadStore() || {}).autoscale || {}
  return {
    enabled: s.enabled !== false,
    browsers: s.browsers !== false,
    terminals: s.terminals !== false,
    custom: Array.isArray(s.custom) ? s.custom.map(normalizeProc) : []
  }
}
let autoscale = loadAutoscaleSettings()
function saveAutoscale () { saveStorePatch({ autoscale }) }

function isManagedProc (procName) {
  if (!autoscale.enabled) return false
  const p = normalizeProc(procName)
  if (autoscale.browsers && BROWSER_SET.has(p)) return true
  if (autoscale.terminals && TERMINAL_SET.has(p)) return true
  if (autoscale.custom.includes(p)) return true
  return false
}

const AUTOSCALE_POLL_MS = 350
const AUTOSCALE_DEBOUNCE_MS = 300
const AUTOSCALE_MIN_DELTA = 4
const autoTrack = new Map() // handle -> { baselineW, baselineH, stableW, stableSince, appliedSteps, process }
let autoscaleTimer = null

async function autoscaleTick () {
  try {
    const list = await winctl.list()
    if (list && list.ok && Array.isArray(list.windows)) {
      const live = new Set()
      const now = Date.now()
      for (const w of list.windows) {
        live.add(w.handle)
        if (w.minimized || !isManagedProc(w.process)) { autoTrack.delete(w.handle); continue }
        let t = autoTrack.get(w.handle)
        if (!t) {
          autoTrack.set(w.handle, { baselineW: w.w, baselineH: w.h, stableW: w.w, stableSince: now, appliedSteps: 0, process: w.process })
          continue // اولین‌بار دیدن پنجره: همین اندازه را مرجع ۱۰۰٪ می‌گیریم، زومی اعمال نمی‌شود
        }
        if (Math.abs(w.w - t.stableW) > AUTOSCALE_MIN_DELTA) {
          t.stableW = w.w
          t.stableSince = now
        } else if (now - t.stableSince >= AUTOSCALE_DEBOUNCE_MS) {
          const steps = zoomStepsFor(t.stableW, t.baselineW)
          if (steps !== t.appliedSteps) {
            t.appliedSteps = steps
            winctl.zoom(w.handle, steps).catch(() => {})
          }
        }
      }
      for (const h of Array.from(autoTrack.keys())) if (!live.has(h)) autoTrack.delete(h)
    }
  } catch (e) {
    console.error('[autoscale] tick failed:', e.message)
  } finally {
    autoscaleTimer = setTimeout(autoscaleTick, AUTOSCALE_POLL_MS)
  }
}
function startAutoscale () { if (!autoscaleTimer) autoscaleTick() }
function stopAutoscale () { if (autoscaleTimer) { clearTimeout(autoscaleTimer); autoscaleTimer = null } }

async function resetAllZoom () {
  const handles = Array.from(autoTrack.keys())
  let changed = 0
  for (const h of handles) {
    const t = autoTrack.get(h)
    if (t && t.appliedSteps !== 0) {
      await winctl.zoom(h, 0).catch(() => {})
      t.appliedSteps = 0
      t.stableW = t.baselineW
      t.stableSince = Date.now()
      changed++
    }
  }
  notify('زوم بازنشانی شد', changed ? (changed + ' پنجره به ۱۰۰٪ برگشت.') : 'همهٔ پنجره‌های مدیریت‌شده همین الان در ۱۰۰٪ هستند.')
}

function notify (title, body) {
  try {
    const { Notification } = require('electron')
    if (Notification.isSupported()) new Notification({ title, body }).show()
    else console.log('[notify]', title, '-', body)
  } catch (_) { console.log('[notify]', title, '-', body) }
}

function buildTrayMenu () {
  const loginSettings = process.platform === 'win32' ? app.getLoginItemSettings() : { openAtLogin: false }
  const icon = (name) => {
    try {
      const p = path.join(__dirname, 'assets', 'icons', name + '16.png')
      const img = nativeImage.createFromPath(p)
      return img.isEmpty() ? undefined : img
    } catch (_) { return undefined }
  }
  return Menu.buildFromTemplate([
    { label: 'پازل‌تب' + (winctl.isMock ? '  (حالت آزمایشی/غیر ویندوز)' : ''), enabled: false },
    { label: autoscale.enabled ? 'فعال — در حال مراقبت از پنجره‌ها' : 'غیرفعال', enabled: false },
    { type: 'separator' },
    {
      label: 'مقیاس‌گذاری خودکار هنگام تغییر اندازه',
      type: 'checkbox',
      checked: autoscale.enabled,
      click: (item) => { autoscale.enabled = item.checked; saveAutoscale(); if (!item.checked) resetAllZoom(); refreshTrayMenu() }
    },
    {
      label: 'برنامه‌های مدیریت‌شده',
      submenu: [
        {
          label: 'مرورگرها (Chrome / Edge / Firefox / Brave / Opera / Vivaldi)',
          type: 'checkbox',
          checked: autoscale.browsers,
          click: (item) => { autoscale.browsers = item.checked; saveAutoscale(); refreshTrayMenu() }
        },
        {
          label: 'ترمینال (Windows Terminal / cmd / PowerShell)',
          type: 'checkbox',
          checked: autoscale.terminals,
          click: (item) => { autoscale.terminals = item.checked; saveAutoscale(); refreshTrayMenu() }
        }
      ]
    },
    { label: 'بازنشانی زوم همه به ۱۰۰٪', icon: icon('zoom-reset'), click: () => resetAllZoom() },
    { type: 'separator' },
    { label: 'حالت کاشی‌های داخلی (تب‌های سایت در یک پنجره)', icon: icon('tiles'), click: () => createEmbeddedWindow() },
    {
      label: 'گزینه‌های پیشرفته',
      submenu: [
        { label: 'چیدمان دستیِ پنجره‌ها (اختیاری — معمولاً لازم نیست)', icon: icon('layout'), click: () => createPickerWindow() }
      ]
    },
    { type: 'separator' },
    {
      label: 'اجرا هنگام ورود به ویندوز',
      type: 'checkbox',
      checked: !!loginSettings.openAtLogin,
      click: (item) => { if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: item.checked }) }
    },
    { type: 'separator' },
    { label: 'خروج از پازل‌تب', icon: icon('exit'), click: () => { app.quit() } }
  ])
}

function refreshTrayMenu () { if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu()) }

function setupTray () {
  try {
    tray = new Tray(nativeImage.createFromPath(trayIconPath()))
    tray.setToolTip('پازل‌تب — مقیاس‌گذاری خودکار پنجره‌های باز ویندوز (بدون نیاز به تنظیم)')
    tray.setContextMenu(buildTrayMenu())
    // عمداً هیچ کلیکی پنجره/باکسی باز نمی‌کند — همه‌چیز فقط از طریق منوی راست‌کلیک کنترل می‌شود.
  } catch (e) {
    console.error('[tray] failed to create tray icon:', e.message)
  }
}

/* ================= تست خودکار حالت قدیم (کاشی‌های داخلی) ================= */
async function runSelfTest () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const killer = setTimeout(() => { console.error('SELFTEST_TIMEOUT'); app.exit(2) }, 150000)
  const w = createEmbeddedWindow()
  await new Promise((res) => w.webContents.once('did-finish-load', res))
  await sleep(1200)
  const ex = (code) => w.webContents.executeJavaScript(code)
  console.log('SELFTEST: adding tile...')
  await ex('window.__test.addTile("https://example.com/", { x: 16, y: 16, w: 560, h: 400, vw: 1280 })')
  await sleep(4000)
  console.log('SELFTEST INFO:', await ex('JSON.stringify(window.__test.info())'))
  console.log('SELFTEST_DONE')
  clearTimeout(killer)
  app.exit(0)
}

/* ================= تست خودکار حالت جدید (Overlay + بک‌اند آزمایشی) ================= */
async function runOverlaySelfTest () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const killer = setTimeout(() => { console.error('SELFTEST_TIMEOUT'); app.exit(2) }, 150000)

  const list = await winctl.list()
  console.log('SELFTEST MOCK LIST:', JSON.stringify(list.windows.map((w) => ({ handle: w.handle, process: w.process, w: w.w, h: w.h }))))

  const ov = createOverlayWindow()
  await new Promise((res) => ov.webContents.once('did-finish-load', res))
  await sleep(600)
  const ex = (code) => ov.webContents.executeJavaScript(code)

  const handles = list.windows.map((w) => w.handle)
  await ex(`window.__otest.seed(${JSON.stringify(handles)})`)
  await sleep(1000)

  console.log('SELFTEST OVERLAY INFO (initial):', await ex('JSON.stringify(window.__otest.info())'))

  const shot1 = await ov.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, 'selftest-overlay-1.png'), shot1.toPNG())

  /* شبیه‌سازی تغییر اندازهٔ یک کاشی (کشیدن گوشهٔ se) */
  const drag = await ex(`(async () => {
    const info = window.__otest.info()
    const c = window.__otest.canvasRect()
    const t = info[0]
    const sel = '.gtile[data-handle="' + t.handle + '"] .rz.se'
    const hx = c.left + t.x + t.w - 4, hy = c.top + t.y + t.h - 4
    window.__otest.pointer(sel, 'pointerdown', hx, hy)
    window.__otest.pointer('body', 'pointermove', hx - 220, hy - 160)
    window.__otest.pointer('body', 'pointerup', hx - 220, hy - 160)
    await new Promise(r => setTimeout(r, 400))
    return { before: t, after: window.__otest.info()[0] }
  })()`)
  console.log('SELFTEST OVERLAY RESIZE:', JSON.stringify(drag))

  await sleep(300)
  const shot2 = await ov.webContents.capturePage()
  fs.writeFileSync(path.join(__dirname, 'selftest-overlay-2.png'), shot2.toPNG())

  /* وضعیت واقعی "پنجره‌ها"ی آزمایشی را از بک‌اند مک بخوانیم تا ببینیم move واقعاً اعمال شده */
  const after = await winctl.list()
  console.log('SELFTEST MOCK LIST AFTER MOVE:', JSON.stringify(after.windows.map((w) => ({ handle: w.handle, process: w.process, x: w.x, y: w.y, w: w.w, h: w.h }))))

  console.log('SELFTEST_OVERLAY_DONE')
  clearTimeout(killer)
  app.exit(0)
}

/* ================= تست خودکار نگهبان مقیاس (بدون UI، فقط با بک‌اند آزمایشی) ================= */
async function runAutoscaleSelfTest () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const killer = setTimeout(() => { console.error('SELFTEST_TIMEOUT'); app.exit(2) }, 60000)
  const fail = (msg) => { console.error('SELFTEST_FAILED:', msg); clearTimeout(killer); app.exit(1) }

  // گام ۱: یک تیک برای این‌که اندازهٔ فعلیِ پنجره‌های مک (chrome=1100, msedge=1000, Telegram, Spotify) به‌عنوان مرجع ۱۰۰٪ ثبت شود.
  await autoscaleTick()
  await sleep(50)
  console.log('SELFTEST AFTER SEED:', JSON.stringify(Array.from(autoTrack.entries())))
  if (!autoTrack.has(1002) || !autoTrack.has(1003)) return fail('مرورگرهای مک باید ردیابی شوند')
  if (autoTrack.has(1001) || autoTrack.has(1004)) return fail('تلگرام/اسپاتیفای نباید ردیابی شوند (مدیریت‌شده نیستند)')

  // گام ۲: شبیه‌سازی کوچک‌کردن دستیِ پنجرهٔ chrome (از 1100 به 550 — دقیقاً نصف)
  await winctl.move([{ handle: 1002, x: 1000, y: 80, w: 550, h: 720 }])
  await autoscaleTick() // اندازه عوض شده -> فقط تایمرِ «ثبات» ریست می‌شود، هنوز زومی اعمال نمی‌شود
  const mid = autoTrack.get(1002)
  if (!mid || mid.appliedSteps !== 0) return fail('نباید فوراً زوم اعمال شود (باید منتظر ثبات اندازه بماند)')

  // گام ۳: صبر برای عبور از آستانهٔ debounce، سپس یک تیک دیگر -> حالا باید زوم اعمال شود
  await sleep(AUTOSCALE_DEBOUNCE_MS + 80)
  await autoscaleTick()
  const after = autoTrack.get(1002)
  const expectedSteps = zoomStepsFor(550, 1100) // 550/1100=50% -> دقیقاً روی سطح ۵۰٪ جدول
  console.log('SELFTEST ZOOM RESULT:', JSON.stringify({ expectedSteps, appliedSteps: after && after.appliedSteps }))
  if (!after || after.appliedSteps !== expectedSteps) return fail('میزان زوم محاسبه/اعمال‌شده با انتظار یکی نیست')

  // گام ۴: تلگرام هرگز نباید مدیریت/زوم شود، حتی اگر تغییر اندازه بدهد
  await winctl.move([{ handle: 1001, x: 80, y: 80, w: 300, h: 640 }])
  await autoscaleTick()
  await sleep(AUTOSCALE_DEBOUNCE_MS + 80)
  await autoscaleTick()
  if (autoTrack.has(1001)) return fail('تلگرام نباید هیچ‌وقت ردیابی/زوم شود')

  // گام ۵: خاموش‌کردن مدیریتِ مرورگرها باید زوم را ریست و ردیابی را متوقف کند
  autoscale.browsers = false
  await resetAllZoom()
  await autoscaleTick()
  if (autoTrack.has(1002) || autoTrack.has(1003)) return fail('بعد از خاموش‌کردن «مرورگرها» دیگر نباید ردیابی شوند')

  console.log('SELFTEST_AUTOSCALE_DONE')
  clearTimeout(killer)
  app.exit(0)
}

/* ================= چرخهٔ حیات برنامه ================= */
const gotLock = IS_SELFTEST || IS_SELFTEST_OVERLAY || IS_SELFTEST_AUTOSCALE || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { /* نمونهٔ دوم فقط بی‌صدا بسته می‌شود؛ هیچ پنجره‌ای باز نمی‌کنیم */ })

  app.whenReady().then(async () => {
    if (IS_SELFTEST) { try { await runSelfTest() } catch (e) { console.error('SELFTEST_FAILED:', e && (e.stack || e.message || e)); app.exit(1) } return }
    if (IS_SELFTEST_OVERLAY) { try { await runOverlaySelfTest() } catch (e) { console.error('SELFTEST_FAILED:', e && (e.stack || e.message || e)); app.exit(1) } return }
    if (IS_SELFTEST_AUTOSCALE) { try { await runAutoscaleSelfTest() } catch (e) { console.error('SELFTEST_FAILED:', e && (e.stack || e.message || e)); app.exit(1) } return }

    setupTray()
    startAutoscale()

    try {
      globalShortcut.register('Control+Alt+P', () => {
        if (overlayWin && !overlayWin.isDestroyed()) closeOverlay()
        else createPickerWindow()
      })
    } catch (_) {}
  })

  app.on('window-all-closed', () => {
    /* عمداً خالی: برنامه باید در System Tray زنده بماند، حتی وقتی هیچ پنجره‌ای باز نیست. */
  })
  app.on('will-quit', () => { globalShortcut.unregisterAll(); stopAutoscale() })
}
