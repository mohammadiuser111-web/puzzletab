'use strict'
;(function () {
  const SNAP_PX = 10
  const MIN_W = 220
  const MIN_H = 140
  const ZOOM_STEPS_TABLE = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]
  const ZOOM_100_INDEX = ZOOM_STEPS_TABLE.indexOf(100) // 7
  const BROWSER_PROCESSES = new Set([
    'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium',
    // پشتیبانیِ احتیاطی از دادهٔ احتمالیِ همراه با پسوند .exe
    'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'chromium.exe'
  ])

  function isBrowserProcess (proc) {
    // Process.ProcessName در ویندوز هرگز شامل پسوند .exe نیست (مثلاً "chrome" نه "chrome.exe")
    // ولی برای اطمینان، پسوند احتمالی را هم حذف می‌کنیم تا با هر دو حالت کار کند.
    const name = String(proc || '').toLowerCase().replace(/\.exe$/, '')
    return BROWSER_PROCESSES.has(name) || BROWSER_PROCESSES.has(name + '.exe')
  }

  // Given a desired on-screen width and the "reference" (100%-layout) width,
  // find how many zoom steps away from 100% gets us closest to displaying
  // the page as if it were refWidth wide inside the actual window width.
  function zoomStepsFor (newWidth, refWidth) {
    if (!refWidth || refWidth <= 0) return 0
    const wantPct = (newWidth / refWidth) * 100
    let bestIdx = ZOOM_100_INDEX
    let bestDiff = Infinity
    for (let i = 0; i < ZOOM_STEPS_TABLE.length; i++) {
      const diff = Math.abs(ZOOM_STEPS_TABLE[i] - wantPct)
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    }
    return bestIdx - ZOOM_100_INDEX
  }

  function pctForSteps (steps) {
    const idx = ZOOM_100_INDEX + steps
    const clamped = Math.max(0, Math.min(ZOOM_STEPS_TABLE.length - 1, idx))
    return ZOOM_STEPS_TABLE[clamped]
  }

  const state = {
    vb: { x: 0, y: 0, w: 1920, h: 1080 },
    ghosts: new Map(), // handle -> { el, handle, title, process, icon, isBrowser, refWidth, x,y,w,h, zoomSteps }
    drag: null,
    persistTimer: null
  }

  const els = {}

  function cache () {
    els.canvas = document.getElementById('canvas')
    els.monitors = document.getElementById('monitors')
    els.empty = document.getElementById('empty')
    els.tpl = document.getElementById('tplGhost')
    els.btnAddMore = document.getElementById('btnAddMore')
    els.btnResetZoom = document.getElementById('btnResetZoom')
    els.btnDone = document.getElementById('btnDone')
  }

  async function applyTheme () {
    try {
      const info = await window.puzzle.info()
      document.documentElement.setAttribute('data-theme', info.dark ? 'dark' : 'light')
    } catch (_) {}
  }

  async function drawMonitors () {
    let res
    try { res = await window.puzzle.screensBounds() } catch (_) { res = null }
    if (!res || !res.virtual) return
    const vb = res.virtual
    state.vb = { x: vb.x, y: vb.y, w: vb.width, h: vb.height }
    els.canvas.style.width = state.vb.w + 'px'
    els.canvas.style.height = state.vb.h + 'px'
    els.monitors.innerHTML = ''
    const displays = res.displays || []
    displays.forEach((d) => {
      const b = d.bounds || d
      const r = document.createElement('div')
      r.className = 'monrect'
      r.style.left = (b.x - state.vb.x) + 'px'
      r.style.top = (b.y - state.vb.y) + 'px'
      r.style.width = b.width + 'px'
      r.style.height = b.height + 'px'
      els.monitors.appendChild(r)
    })
  }

  function updateEmptyState () {
    els.empty.hidden = state.ghosts.size !== 0
  }

  function updateHeadPos (g) {
    if (g.y < 40) g.el.classList.add('headInside')
    else g.el.classList.remove('headInside')
  }

  function escapeHtml (s) {
    const d = document.createElement('div')
    d.textContent = String(s)
    return d.innerHTML
  }

  function makeGhost (win, rectOverride) {
    const frag = els.tpl.content.cloneNode(true)
    const el = frag.querySelector('.gtile')
    el.dataset.handle = String(win.handle)
    const icImg = frag.querySelector('.gic img')
    const titleEl = frag.querySelector('.gtitle')
    const refSel = frag.querySelector('.gref')
    const btnX = frag.querySelector('.gx')
    const btnMin = frag.querySelector('.gmin')
    const btnMax = frag.querySelector('.gmax')
    const minOverlay = frag.querySelector('.gminOverlay')

    const isBrowser = isBrowserProcess(win.process)
    titleEl.textContent = win.title || win.process || 'پنجره'
    if (win.icon) { icImg.src = 'data:image/png;base64,' + win.icon; icImg.hidden = false }

    let x, y, w, h
    if (rectOverride) {
      x = rectOverride.x; y = rectOverride.y; w = rectOverride.w; h = rectOverride.h
    } else if (typeof win.x === 'number' && typeof win.y === 'number') {
      x = win.x - state.vb.x; y = win.y - state.vb.y; w = win.w; h = win.h
    } else {
      x = 80 + (state.ghosts.size % 5) * 40
      y = 80 + (state.ghosts.size % 5) * 40
      w = 640; h = 420
    }
    w = Math.max(MIN_W, w); h = Math.max(MIN_H, h)

    el.style.left = x + 'px'
    el.style.top = y + 'px'
    el.style.width = w + 'px'
    el.style.height = h + 'px'
    if (y < 40) el.classList.add('headInside')

    const g = {
      el, handle: win.handle, title: win.title, process: win.process, icon: win.icon,
      isBrowser, refWidth: (win.managed && win.managed.refWidth) || 1280,
      x, y, w, h, zoomSteps: 0, minimized: false, maxState: null
    }

    if (isBrowser) {
      refSel.hidden = false
      refSel.value = String(g.refWidth)
      refSel.addEventListener('change', () => {
        g.refWidth = parseInt(refSel.value, 10) || 1280
        applyZoomFor(g)
        schedulePersist()
      })
    } else {
      refSel.hidden = true
    }

    btnX.addEventListener('click', (e) => {
      e.stopPropagation()
      removeGhost(g.handle)
    })

    btnMin.addEventListener('click', async (e) => {
      e.stopPropagation()
      g.minimized = true
      el.classList.add('minimized')
      minOverlay.hidden = false
      try { await window.puzzle.winMinimize(g.handle) } catch (_) {}
    })

    minOverlay.addEventListener('click', async (e) => {
      e.stopPropagation()
      g.minimized = false
      el.classList.remove('minimized')
      minOverlay.hidden = true
      try { await window.puzzle.winFocus(g.handle) } catch (_) {}
    })

    btnMax.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!g.maxState) {
        g.maxState = { x: g.x, y: g.y, w: g.w, h: g.h }
        g.x = 0; g.y = 0; g.w = state.vb.w; g.h = state.vb.h
        el.classList.add('gmaximized')
      } else {
        const prev = g.maxState
        g.maxState = null
        g.x = prev.x; g.y = prev.y; g.w = prev.w; g.h = prev.h
        el.classList.remove('gmaximized')
      }
      el.style.left = g.x + 'px'; el.style.top = g.y + 'px'
      el.style.width = g.w + 'px'; el.style.height = g.h + 'px'
      updateHeadPos(g)
      await applyMove(g)
      if (g.isBrowser) await applyZoomFor(g)
      schedulePersist()
    })

    // جلوگیری از شروعِ کشیدن (drag) هنگام کلیک روی دکمه‌های نوارِ عنوان
    el.querySelector('.gcaps').addEventListener('pointerdown', (e) => e.stopPropagation())
    refSel.addEventListener('pointerdown', (e) => e.stopPropagation())

    bindDragResize(el, g)

    els.canvas.appendChild(el)
    state.ghosts.set(win.handle, g)
    updateEmptyState()
    return g
  }

  function removeGhost (handle) {
    const g = state.ghosts.get(handle)
    if (!g) return
    g.el.remove()
    state.ghosts.delete(handle)
    updateEmptyState()
    schedulePersist()
  }

  function bindDragResize (el, g) {
    const head = el.querySelector('.ghead')
    head.addEventListener('pointerdown', (e) => startDrag(e, g, 'move'))
    el.querySelectorAll('.rz').forEach((h) => {
      h.addEventListener('pointerdown', (e) => startDrag(e, g, h.dataset.dir))
    })
  }

  function startDrag (e, g, mode) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const orig = { x: g.x, y: g.y, w: g.w, h: g.h }
    state.drag = { g, mode, startX, startY, orig }
    g.el.classList.add(mode === 'move' ? 'dragging' : 'resizing')
    try { g.el.setPointerCapture(e.pointerId) } catch (_) {}
    const onMove = (ev) => handlePointerMove(ev)
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      finishDrag()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function snap (v) {
    const r = Math.round(v / SNAP_PX) * SNAP_PX
    return r
  }

  function handlePointerMove (e) {
    const d = state.drag
    if (!d) return
    const { g, mode, startX, startY, orig } = d
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    let x = orig.x, y = orig.y, w = orig.w, h = orig.h

    if (mode === 'move') {
      x = orig.x + dx
      y = orig.y + dy
    } else {
      if (mode.includes('e')) w = Math.max(MIN_W, orig.w + dx)
      if (mode.includes('s')) h = Math.max(MIN_H, orig.h + dy)
      if (mode.includes('w')) {
        w = Math.max(MIN_W, orig.w - dx)
        x = orig.x + (orig.w - w)
      }
      if (mode.includes('n')) {
        h = Math.max(MIN_H, orig.h - dy)
        y = orig.y + (orig.h - h)
      }
    }

    x = snap(x); y = snap(y); w = snap(w); h = snap(h)

    g.x = x; g.y = y; g.w = w; g.h = h
    g.el.style.left = x + 'px'
    g.el.style.top = y + 'px'
    g.el.style.width = w + 'px'
    g.el.style.height = h + 'px'
    updateHeadPos(g)
  }

  function finishDrag () {
    const d = state.drag
    if (!d) return
    d.g.el.classList.remove('dragging', 'resizing')
    state.drag = null
    applyMove(d.g)
    if (d.g.isBrowser) applyZoomFor(d.g)
    schedulePersist()
  }

  async function applyMove (g) {
    const absX = state.vb.x + g.x
    const absY = state.vb.y + g.y
    try {
      await window.puzzle.winMove([{ handle: g.handle, x: absX, y: absY, w: g.w, h: g.h }])
    } catch (_) {}
  }

  async function applyZoomFor (g) {
    if (!g.isBrowser) return
    const steps = zoomStepsFor(g.w, g.refWidth)
    g.zoomSteps = steps
    try {
      await window.puzzle.winZoom(g.handle, steps)
    } catch (_) {}
  }

  function schedulePersist () {
    if (state.persistTimer) clearTimeout(state.persistTimer)
    state.persistTimer = setTimeout(persist, 350)
  }

  async function persist () {
    const items = []
    state.ghosts.forEach((g) => {
      items.push({
        matchProcess: g.process,
        matchTitleContains: g.title,
        refWidth: g.refWidth,
        isBrowser: g.isBrowser,
        lastRect: { x: state.vb.x + g.x, y: state.vb.y + g.y, w: g.w, h: g.h }
      })
    })
    try { await window.puzzle.saveManaged({ items }) } catch (_) {}
  }

  async function seed (handles) {
    if (!handles || !handles.length) return
    let res
    try { res = await window.puzzle.winList() } catch (e) { res = { ok: false } }
    if (!res || !res.ok) return
    const byHandle = new Map((res.windows || []).map((w) => [w.handle, w]))
    handles.forEach((h) => {
      if (state.ghosts.has(h)) return
      const w = byHandle.get(h)
      if (!w) return
      makeGhost(w)
    })
    schedulePersist()
  }

  async function openPickerForMore () {
    try { await window.puzzle.openPicker() } catch (_) {}
  }

  async function resetAllZoom () {
    const tasks = []
    state.ghosts.forEach((g) => {
      if (!g.isBrowser) return
      g.zoomSteps = 0
      tasks.push(window.puzzle.winZoom(g.handle, 0))
    })
    try { await Promise.all(tasks) } catch (_) {}
  }

  function closeOverlay () {
    try { window.puzzle.closeOverlay() } catch (_) { window.close() }
  }

  function wire () {
    els.btnAddMore.addEventListener('click', openPickerForMore)
    els.btnResetZoom.addEventListener('click', resetAllZoom)
    els.btnDone.addEventListener('click', closeOverlay)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOverlay()
    })
    if (window.puzzle && window.puzzle.onOverlaySeed) {
      window.puzzle.onOverlaySeed((handles) => { seed(handles) })
    }
  }

  async function init () {
    cache()
    wire()
    await applyTheme()
    await drawMonitors()
    updateEmptyState()

    window.__otest = {
      seed,
      info: () => Array.from(state.ghosts.values()).map((g) => ({
        handle: g.handle, process: g.process, isBrowser: g.isBrowser,
        refWidth: g.refWidth, x: g.x, y: g.y, w: g.w, h: g.h, zoomSteps: g.zoomSteps
      })),
      canvasRect: () => els.canvas.getBoundingClientRect(),
      pointer: (selector, type, x, y) => {
        const el = document.querySelector(selector)
        if (!el) return false
        let ev
        try {
          ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 })
        } catch (_) {
          ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
        }
        el.dispatchEvent(ev)
        return true
      },
      zoomStepsFor
    }

    if (window.puzzle && window.puzzle.info) {
      try {
        const q = new URLSearchParams(location.search)
        const handlesParam = q.get('handles')
        if (handlesParam) await seed(handlesParam.split(',').filter(Boolean))
      } catch (_) {}
    }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
