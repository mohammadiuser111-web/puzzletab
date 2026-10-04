'use strict'
/* winctl.js — پل بین الکترون و winhelper.ps1 (کنترل پنجره‌های واقعی ویندوز)
 * روی غیر از ویندوز (لینوکس/مک، یا حالت --selftest) از یک «بک‌اند آزمایشی» حافظه‌ای
 * استفاده می‌شود تا بشود منطق Overlay (کشیدن/تغییراندازه/محاسبهٔ زوم) را بدون ویندوز هم تست کرد.
 */

const { execFile } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')

let appRef = null
function init (app) { appRef = app }

function helperScriptPath () {
  const packaged = appRef && appRef.isPackaged
  return packaged
    ? path.join(process.resourcesPath, 'winhelper', 'winhelper.ps1')
    : path.join(__dirname, 'winhelper', 'winhelper.ps1')
}

function runPS (args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const script = helperScriptPath()
    const fullArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, ...args]
    execFile('powershell.exe', fullArgs, {
      timeout: timeoutMs || 15000,
      maxBuffer: 1024 * 1024 * 32,
      windowsHide: true
    }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim()
      if (!out) return reject(new Error((stderr && String(stderr).trim()) || (err && err.message) || 'خروجی خالی از PowerShell'))
      try {
        resolve(JSON.parse(out))
      } catch (e) {
        reject(new Error('پاسخ نامعتبر از PowerShell: ' + out.slice(0, 400)))
      }
    })
  })
}

function withTempJson (data, fn) {
  const file = path.join(os.tmpdir(), 'puzzletab-' + crypto.randomBytes(6).toString('hex') + '.json')
  fs.writeFileSync(file, JSON.stringify(data), 'utf8')
  return fn(file).finally(() => { try { fs.unlinkSync(file) } catch (_) {} })
}

const realBackend = {
  list: () => runPS(['-Cmd', 'list']),
  rect: (handle) => runPS(['-Cmd', 'rect', '-Handle', String(handle)]),
  move: (items) => withTempJson(items, (file) => runPS(['-Cmd', 'move', '-BatchFile', file])),
  zoom: (handle, steps) => runPS(['-Cmd', 'zoom', '-Handle', String(handle), '-Steps', String(steps)], 20000),
  focus: (handle) => runPS(['-Cmd', 'focus', '-Handle', String(handle)]),
  minimize: (handle) => runPS(['-Cmd', 'minimize', '-Handle', String(handle)])
}

/* ---------- بک‌اند آزمایشی (برای توسعه/تست روی غیر ویندوز) ---------- */
/* توجه: process بدون پسوند .exe است — دقیقاً مثل واقعیت در ویندوز
 * (Process.ProcessName در دات‌نت هرگز شامل .exe نیست)، تا باگ‌های
 * مشابهِ تطبیقِ نام پردازش در تست خودکار هم قابل تشخیص باشند. */
const mockState = new Map([
  [1001, { handle: 1001, title: 'تلگرام دسکتاپ — گفتگوها', pid: 111, process: 'Telegram', exePath: 'C:/Apps/Telegram.exe', x: 80, y: 80, w: 900, h: 640, maximized: false, minimized: false, icon: null }],
  [1002, { handle: 1002, title: 'Telegram Web — Chrome', pid: 222, process: 'chrome', exePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', x: 1000, y: 80, w: 1100, h: 720, maximized: false, minimized: false, icon: null }],
  [1003, { handle: 1003, title: 'آپارات — Microsoft Edge', pid: 333, process: 'msedge', exePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', x: 150, y: 760, w: 1000, h: 600, maximized: false, minimized: false, icon: null }],
  [1004, { handle: 1004, title: 'Spotify', pid: 444, process: 'Spotify', exePath: 'C:/Users/me/AppData/Roaming/Spotify/Spotify.exe', x: 1200, y: 760, w: 760, h: 520, maximized: false, minimized: false, icon: null }]
])

const mockBackend = {
  async list () {
    return { ok: true, windows: Array.from(mockState.values()).map((w) => ({ ...w })) }
  },
  async rect (handle) {
    const w = mockState.get(Number(handle))
    return { ok: !!w, window: w ? { ...w } : null }
  },
  async move (items) {
    const results = items.map((it) => {
      const w = mockState.get(Number(it.handle))
      if (!w) return { handle: it.handle, ok: false, error: 'window not found (mock)' }
      w.x = Math.round(it.x); w.y = Math.round(it.y); w.w = Math.round(it.w); w.h = Math.round(it.h)
      w.maximized = false; w.minimized = false
      console.log('[winctl:mock] move', w.handle, w.process, '->', w.x, w.y, w.w, w.h)
      return { handle: it.handle, ok: true }
    })
    return { ok: true, results }
  },
  async zoom (handle, steps) {
    const w = mockState.get(Number(handle))
    console.log('[winctl:mock] zoom', handle, (w && w.process) || '?', 'steps=', steps)
    return { ok: true, mock: true, steps }
  },
  async focus (handle) {
    console.log('[winctl:mock] focus', handle)
    const w = mockState.get(Number(handle))
    if (w) w.minimized = false
    return { ok: true }
  },
  async minimize (handle) {
    console.log('[winctl:mock] minimize', handle)
    const w = mockState.get(Number(handle))
    if (w) w.minimized = true
    return { ok: true }
  }
}

const USE_MOCK = process.platform !== 'win32' || process.env.PUZZLETAB_MOCK_WIN === '1'
const backend = USE_MOCK ? mockBackend : realBackend

module.exports = { init, isMock: USE_MOCK, ...backend }
