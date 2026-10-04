'use strict'
/* winmirror.js — پل بین الکترون و winmirror.exe (ابزار کمکیِ بومی که با DWM Thumbnail
 * یک «آینهٔ زنده» از یک پنجرهٔ واقعیِ پارک‌شده (خارج از صفحه، در اندازهٔ ثابتِ ۱۰۰٪) نشان می‌دهد).
 * روی غیر از ویندوز (یا در حالت --selftest) یک بک‌اند آزمایشیِ حافظه‌ای استفاده می‌شود تا منطق
 * سمتِ Node (صف دستورها، مسیریابی رویدادها) بدون ویندوز هم تست شود.
 */

const { spawn } = require('child_process')
const path = require('path')
const readline = require('readline')
const { EventEmitter } = require('events')

let appRef = null
function init (app) { appRef = app }

function helperExePath () {
  const packaged = appRef && appRef.isPackaged
  return packaged
    ? path.join(process.resourcesPath, 'winmirror', 'winmirror.exe')
    : path.join(__dirname, 'winmirror', 'publish', 'winmirror.exe')
}

const SPONTANEOUS_EVENTS = new Set(['ready', 'moved', 'sourceLost', 'wantsRestore', 'shutdown-complete'])

class RealBackend extends EventEmitter {
  constructor () {
    super()
    this.proc = null
    this.pending = []
    this.starting = null
  }

  start () {
    if (this.proc) return Promise.resolve(true)
    if (this.starting) return this.starting
    this.starting = new Promise((resolve, reject) => {
      const exe = helperExePath()
      let child
      try {
        child = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (e) { reject(e); return }
      this.proc = child
      const rl = readline.createInterface({ input: child.stdout })
      rl.on('line', (line) => this._onLine(line))
      child.stderr.on('data', (d) => console.error('[winmirror:stderr]', String(d)))
      child.on('exit', (code) => {
        console.error('[winmirror] process exited, code=', code)
        this.proc = null
        for (const p of this.pending.splice(0)) p.reject(new Error('winmirror exited'))
        this.emit('exit', code)
      })
      const onReady = () => { clearTimeout(timer); resolve(true) }
      this.once('ready', onReady)
      const timer = setTimeout(() => { this.off('ready', onReady); reject(new Error('winmirror startup timeout')) }, 8000)
    })
    return this.starting
  }

  _onLine (line) {
    let obj
    try { obj = JSON.parse(line) } catch (_) { console.error('[winmirror] bad line:', line); return }
    if (obj.event && SPONTANEOUS_EVENTS.has(obj.event)) {
      this.emit(obj.event, obj)
      return
    }
    const p = this.pending.shift()
    if (!p) { console.error('[winmirror] unexpected reply with no pending command:', line); return }
    if (obj.ok) p.resolve(obj)
    else p.reject(new Error(obj.error || 'winmirror command failed'))
  }

  _send (cmdObj) {
    if (!this.proc) return Promise.reject(new Error('winmirror not started'))
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.proc.stdin.write(JSON.stringify(cmdObj) + '\n')
    })
  }

  createMirror (id, sourceHandle, rect, processName) {
    return this._send({ cmd: 'create', id, source: Number(sourceHandle), x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h), process: processName || '' })
  }

  moveMirror (id, rect) {
    return this._send({ cmd: 'move', id, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) })
  }

  setAccent (id, colorHex) { return this._send({ cmd: 'setAccent', id, color: colorHex }) }
  destroyMirror (id, restore) { return this._send({ cmd: 'destroy', id, restore: restore !== false }) }
  list () { return this._send({ cmd: 'list' }) }

  shutdown () {
    if (!this.proc) return Promise.resolve(true)
    return this._send({ cmd: 'shutdown' }).catch(() => {}).then(() => true)
  }
}

/* ---------- بک‌اند آزمایشی (برای توسعه/تست روی غیر ویندوز) ---------- */
class MockBackend extends EventEmitter {
  constructor () {
    super()
    this.mirrors = new Map()
  }

  start () { setTimeout(() => this.emit('ready', { ok: true, event: 'ready' }), 10); return Promise.resolve(true) }

  async createMirror (id, sourceHandle, rect, processName) {
    console.log('[winmirror:mock] create', id, 'source=', sourceHandle, 'rect=', rect, 'process=', processName)
    this.mirrors.set(id, { id, sourceHandle, rect: { ...rect }, processName })
    return { ok: true, id, event: 'created' }
  }

  async moveMirror (id, rect) {
    const m = this.mirrors.get(id)
    if (!m) return { ok: false, id, error: 'no such mirror' }
    m.rect = { ...rect }
    console.log('[winmirror:mock] move', id, rect)
    return { ok: true, id }
  }

  async setAccent (id, colorHex) {
    if (!this.mirrors.has(id)) return { ok: false, id, error: 'no such mirror' }
    return { ok: true, id }
  }

  async destroyMirror (id, restore) {
    const existed = this.mirrors.delete(id)
    console.log('[winmirror:mock] destroy', id, 'restore=', restore !== false)
    return existed ? { ok: true, id, event: 'destroyed' } : { ok: false, id, error: 'no such mirror' }
  }

  async list () {
    return { ok: true, mirrors: Array.from(this.mirrors.values()).map((m) => ({ id: m.id, source: m.sourceHandle, process: m.processName })) }
  }

  shutdown () { this.mirrors.clear(); return Promise.resolve(true) }

  /* فقط برای self-test: شبیه‌سازیِ رویدادهای خودجوش (sourceLost / wantsRestore)
   * نکته: در بک‌اند واقعی (winmirror.exe)، وقتی پنجرهٔ منبع بسته شود، خودِ برنامهٔ C# پیش از emit
   * کردنِ sourceLost آینه را از دیکشنری داخلی‌اش هم حذف می‌کند — همین رفتار را اینجا هم شبیه‌سازی می‌کنیم
   * تا تستِ خودکار واقعی باشد. */
  mockEmitEvent (name, payload) {
    if (name === 'sourceLost' && payload && this.mirrors.has(payload.id)) this.mirrors.delete(payload.id)
    this.emit(name, payload)
  }
}

const USE_MOCK = process.platform !== 'win32' || process.env.PUZZLETAB_MOCK_WIN === '1'
const backend = USE_MOCK ? new MockBackend() : new RealBackend()

module.exports = { init, isMock: USE_MOCK, backend }
