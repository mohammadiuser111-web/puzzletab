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

async function applyLastManagedLayout () {
  const managed = (loadStore() || {}).managed
  if (!managed || !Array.isArray(managed.items) || !managed.items.length) {
    notify('چیدمانی ذخیره نشده', 'اول از «چیدمان پنجره‌های باز…» چند پنجره انتخاب و مرتب کن.')
    return
  }
  let list
  try { list = await winctl.list() } catch (e) { notify('خطا', e.message); return }
  if (!list || !list.ok) { notify('خطا در خواندن پنجره‌ها', (list && list.error) || ''); return }

  const moves = []
  let matched = 0
  for (const item of managed.items) {
    const found = list.windows.find((w) =>
      (!item.matchProcess || w.process.toLowerCase() === item.matchProcess.toLowerCase()) &&
      (!item.matchTitleContains || w.title.includes(item.matchTitleContains))
    )
    if (found && item.lastRect) {
      matched++
      moves.push({ handle: found.handle, x: item.lastRect.x, y: item.lastRect.y, w: item.lastRect.w, h: item.lastRect.h })
      if (item.isBrowser) {
        const steps = zoomStepsFor(item.lastRect.w, item.refWidth || 1280)
        winctl.zoom(found.handle, steps).catch(() => {})
      }
    }
  }
  if (moves.length) await winctl.move(moves).catch(() => {})
  notify('چیدمان اعمال شد', matched + ' از ' + managed.items.length + ' پنجره پیدا و جابه‌جا شد.')
}

const ZOOM_STEPS_TABLE = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]
function zoomStepsFor (newWidth, refWidth) {
  const pct = Math.max(25, Math.min(500, Math.round((newWidth / refWidth) * 100)))
  let best = 0, bestDiff = Infinity
  ZOOM_STEPS_TABLE.forEach((v, idx) => {
    const d = Math.abs(v - pct)
    if (d < bestDiff) { bestDiff = d; best = idx }
  })
  return best - ZOOM_STEPS_TABLE.indexOf(100)
}

async function resetAllZoom () {
  const managed = (loadStore() || {}).managed
  if (!managed || !Array.isArray(managed.items)) return
  let list
  try { list = await winctl.list() } catch (_) { return }
  if (!list || !list.ok) return
  for (const item of managed.items) {
    if (!item.isBrowser) continue
    const found = list.windows.find((w) => (!item.matchProcess || w.process.toLowerCase() === item.matchProcess.toLowerCase()))
    if (found) await winctl.zoom(found.handle, 0).catch(() => {})
  }
  notify('زوم بازنشانی شد', 'زوم مرورگرهای مدیریت‌شده به ۱۰۰٪ برگشت.')
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
  return Menu.buildFromTemplate([
    { label: 'پازل‌تب' + (winctl.isMock ? '  (حالت آزمایشی/غیر ویندوز)' : ''), enabled: false },
    { type: 'separator' },
    { label: '🧩 چیدمان پنجره‌های باز…', click: () => createPickerWindow() },
    { label: '↻ اعمال آخرین چیدمان', click: () => applyLastManagedLayout() },
    { label: '🔍 بازنشانی زوم مرورگرها', click: () => resetAllZoom() },
    { type: 'separator' },
    { label: '🗂 حالت کاشی‌های داخلی (تب‌های سایت در یک پنجره)', click: () => createEmbeddedWindow() },
    { type: 'separator' },
    {
      label: 'اجرا هنگام ورود به ویندوز',
      type: 'checkbox',
      checked: !!loginSettings.openAtLogin,
      click: (item) => { if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: item.checked }) }
    },
    { type: 'separator' },
    { label: 'خروج از پازل‌تب', click: () => { app.quit() } }
  ])
}

function setupTray () {
  try {
    tray = new Tray(nativeImage.createFromPath(trayIconPath()))
    tray.setToolTip('پازل‌تب — چیدمان پازلیِ پنجره‌های باز ویندوز')
    tray.setContextMenu(buildTrayMenu())
    tray.on('click', () => createPickerWindow())
    tray.on('double-click', () => createPickerWindow())
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

/* ================= چرخهٔ حیات برنامه ================= */
const gotLock = IS_SELFTEST || IS_SELFTEST_OVERLAY || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { createPickerWindow() })

  app.whenReady().then(async () => {
    if (IS_SELFTEST) { try { await runSelfTest() } catch (e) { console.error('SELFTEST_FAILED:', e && (e.stack || e.message || e)); app.exit(1) } return }
    if (IS_SELFTEST_OVERLAY) { try { await runOverlaySelfTest() } catch (e) { console.error('SELFTEST_FAILED:', e && (e.stack || e.message || e)); app.exit(1) } return }

    setupTray()

    try {
      globalShortcut.register('Control+Alt+P', () => {
        if (overlayWin && !overlayWin.isDestroyed()) closeOverlay()
        else createPickerWindow()
      })
    } catch (_) {}

    app.on('activate', () => { createPickerWindow() })
  })

  app.on('window-all-closed', () => {
    /* عمداً خالی: برنامه باید در System Tray زنده بماند، حتی وقتی هیچ پنجره‌ای باز نیست. */
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
