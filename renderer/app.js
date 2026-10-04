'use strict'
/* پازل‌تب — منطق رابط کاربری
 * ترفند اصلی: هر <webview> را با zoomFactor = (عرض کاشی / عرض مجازی دسکتاپ) رندر می‌کنیم.
 * چون در کروم، کوچک‌نمایی (zoom) عرضِ Viewport منطقی صفحه را افزایش می‌دهد، سایت فکر می‌کند
 * روی یک مانیتور با همان «عرض مجازی» باز شده و حالت موبایل/ریسپانسیو را فعال نمی‌کند —
 * فقط کوچک‌تر دیده می‌شود. هر کاشی هم نشست (partition) جدا دارد تا زوم یک کاشی
 * روی بقیهٔ کاشی‌های هم‌دامنه اثر نگذارد و هر کاشی بتواند لاگین مستقل داشته باشد.
 */

;(function () {
  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))

  const GAP = 10
  const MIN_W = 260
  const MIN_H = 190
  const SNAP_PX = 9
  const DEFAULT_VW = 1280

  const VW_PRESETS = [
    { v: 1920, l: 'مانیتور بزرگ (1920)' },
    { v: 1536, l: 'دسکتاپ (1536)' },
    { v: 1280, l: 'پیش‌فرض (1280)' },
    { v: 1024, l: 'لپ‌تاپ کوچک (1024)' },
    { v: 820, l: 'تبلت (820)' },
    { v: 390, l: 'موبایل واقعی (390) — برای تست' }
  ]

  const QUICK_SITES = [
    { k: 'telegram', t: 'تلگرام وب', u: 'https://web.telegram.org/k/', c: '#29a9eb', vw: 1280 },
    { k: 'aparat', t: 'آپارات', u: 'https://www.aparat.com/', c: '#ff5722', vw: 1280 },
    { k: 'youtube', t: 'یوتیوب', u: 'https://www.youtube.com/', c: '#ff0000', vw: 1280 },
    { k: 'whatsapp', t: 'واتساپ وب', u: 'https://web.whatsapp.com/', c: '#25d366', vw: 1100 },
    { k: 'instagram', t: 'اینستاگرام', u: 'https://www.instagram.com/', c: '#d62976', vw: 1280 },
    { k: 'x', t: 'ایکس / توییتر', u: 'https://x.com/', c: '#536471', vw: 1280 },
    { k: 'discord', t: 'دیسکورد', u: 'https://discord.com/app', c: '#5865f2', vw: 1280 },
    { k: 'chatgpt', t: 'چت‌جی‌پی‌تی', u: 'https://chatgpt.com/', c: '#10a37f', vw: 1280 }
  ]

  const ICONS = {
    add: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.75.75 0 0 1 .75.75V7.25h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5V2.75A.75.75 0 0 1 8 2Z"/></svg>',
    grid: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Zm7 0a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V3ZM2 10a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3Zm7 0a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3Z"/></svg>',
    layout: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.75A.75.75 0 0 1 2.75 2h10.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H2.75a.75.75 0 0 1-.75-.75V2.75ZM3.5 3.5v3h9v-3h-9Zm0 4.5v4.5h3V8h-3Zm4.5 0v4.5h4.5V8H8Z"/></svg>',
    sun: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a.75.75 0 0 1 .75.75V3.5a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 8 1.5Zm0 11a.75.75 0 0 1 .75.75v1.25a.75.75 0 0 1-1.5 0V13.25A.75.75 0 0 1 8 12.5Zm6.5-4.5a.75.75 0 0 1-.75.75H12.5a.75.75 0 0 1 0-1.5h1.25a.75.75 0 0 1 .75.75Zm-11 0a.75.75 0 0 1-.75.75H2.5a.75.75 0 0 1 0-1.5h1.25a.75.75 0 0 1 .75.75Zm9.58-4.83a.75.75 0 0 1 0 1.06l-.88.89a.75.75 0 1 1-1.06-1.06l.88-.89a.75.75 0 0 1 1.06 0ZM4.86 11.56a.75.75 0 0 1 0 1.06l-.89.88a.75.75 0 1 1-1.06-1.06l.89-.88a.75.75 0 0 1 1.06 0Zm7.09 1.94a.75.75 0 0 1-1.06 0l-.88-.88a.75.75 0 1 1 1.06-1.06l.88.88a.75.75 0 0 1 0 1.06ZM4.86 4.44a.75.75 0 0 1-1.06 0l-.89-.88a.75.75 0 0 1 1.06-1.06l.89.88a.75.75 0 0 1 0 1.06ZM8 4.75A3.25 3.25 0 1 1 4.75 8 3.25 3.25 0 0 1 8 4.75Z"/></svg>',
    moon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.3a6.86 6.86 0 1 0 8.2 8.2 6 6 0 0 1-8.2-8.2Z"/></svg>',
    back: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M9.78 3.22a.75.75 0 0 1 0 1.06L5.56 8.5l4.22 4.22a.75.75 0 1 1-1.06 1.06L4.17 9.03a.75.75 0 0 1 0-1.06l4.55-4.75a.75.75 0 0 1 1.06 0Z"/></svg>',
    fwd: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M6.22 3.22a.75.75 0 0 0 0 1.06L10.44 8.5 6.22 12.72a.75.75 0 1 0 1.06 1.06l4.55-4.75a.75.75 0 0 0 0-1.06L7.28 3.22a.75.75 0 0 0-1.06 0Z"/></svg>',
    reload: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2.5a5.5 5.5 0 1 0 5.17 3.6.75.75 0 0 1 1.41-.5A7 7 0 1 1 8 1v-.75a.37.37 0 0 1 .62-.27l2.1 1.9a.37.37 0 0 1 0 .55l-2.1 1.9A.37.37 0 0 1 8 4.06V2.5Z"/></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 8a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 4 8Zm5.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM13.25 8a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z"/></svg>',
    close: '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06Z"/></svg>',
    external: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.75A.75.75 0 0 1 5.25 2h4a.75.75 0 0 1 0 1.5H6.56l6.72 6.72a.75.75 0 1 1-1.06 1.06L5.5 4.56v2.69a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .5-.5Zm-1 3.5a.75.75 0 0 1 .75.75v5.5h5.5a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1-.75-.75V7a.75.75 0 0 1 .5-.75Z"/></svg>',
    copy: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5A1.5 1.5 0 0 1 5.5 1h5A1.5 1.5 0 0 1 12 2.5v1h-1v-1a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h1v1h-1A1.5 1.5 0 0 1 4 10.5v-8ZM6.5 5h5A1.5 1.5 0 0 1 13 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 5 13.5v-7A1.5 1.5 0 0 1 6.5 5Z"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1h3a1 1 0 0 1 1 1v1h3a.5.5 0 0 1 0 1h-.54l-.78 8.6A2 2 0 0 1 10.19 14H5.81a2 2 0 0 1-1.99-1.4L3.04 4H2.5a.5.5 0 0 1 0-1h3V2a1 1 0 0 1 1-1Zm0 1v1h3V2h-3ZM4.05 4l.77 8.5a1 1 0 0 0 1 .9h4.36a1 1 0 0 0 1-.9L11.95 4h-7.9Z"/></svg>',
    maximize: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h7A1.5 1.5 0 0 1 13 3.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 10.5v-7ZM4.5 3.2a.3.3 0 0 0-.3.3v7a.3.3 0 0 0 .3.3h7a.3.3 0 0 0 .3-.3v-7a.3.3 0 0 0-.3-.3h-7Z"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.63 3.72a.75.75 0 0 1 .1 1.06l-6.5 7.75a.75.75 0 0 1-1.12.05l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.9 2.9 5.99-7.14a.75.75 0 0 1 1.07-.06Z"/></svg>',
    empty: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="8" height="7" rx="1.4"/><rect x="13" y="4" width="8" height="12" rx="1.4"/><rect x="3" y="13" width="8" height="7" rx="1.4"/></svg>'
  }

  /* ---------- وضعیت ---------- */
  const state = {
    tiles: new Map(), /* id -> {id,url,x,y,w,h,vw,title,el,webview,partition,maxed,prevRect} */
    order: [], /* ترتیب z از پایین به بالا */
    layouts: [],
    canvasSize: { w: 0, h: 0 },
    snap: true,
    zCounter: 1,
    dragSeq: 0
  }

  const els = {}

  function uid () {
    try { return crypto.randomUUID() } catch (_) { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
  }

  function clamp (v, a, b) { return Math.max(a, Math.min(b, v)) }

  function normalizeUrl (raw) {
    let s = String(raw || '').trim()
    if (!s) return ''
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(s)) return 'https://' + s
    return 'https://www.google.com/search?q=' + encodeURIComponent(s)
  }

  function faviconFor (url) {
    try {
      const u = new URL(url)
      return 'https://www.google.com/s2/favicons?sz=64&domain=' + u.hostname
    } catch (_) { return '' }
  }

  /* ================= راه‌اندازی ================= */
  async function init () {
    cacheEls()
    wireToolbar()
    wireGlobalPointer()
    wireEmptyQuick()

    window.__test = buildTestApi()

    let info = { dark: true, accent: '#0078d4', win11: false, platform: 'other' }
    try { info = await window.puzzle.info() } catch (_) { /* no preload (dev) */ }
    applySysInfo(info)
    if (window.puzzle && window.puzzle.onTheme) window.puzzle.onTheme(applySysInfo)

    const saved = window.puzzle ? await window.puzzle.loadStore() : null
    state.layouts = (saved && Array.isArray(saved.layouts)) ? saved.layouts : []

    measureCanvas()

    if (saved && Array.isArray(saved.tiles) && saved.tiles.length) {
      if (saved.canvasSize && saved.canvasSize.w && saved.canvasSize.h) {
        rescaleIncoming(saved.tiles, saved.canvasSize, state.canvasSize)
      }
      saved.tiles.forEach((t) => mountTile(t, { skipSave: true }))
    }

    refreshEmptyState()
    window.addEventListener('resize', onWindowResize)
  }

  function cacheEls () {
    els.canvas = $('#canvas')
    els.empty = $('#empty')
    els.emptyQuick = $('#emptyQuick')
    els.toolbar = $('#toolbar')
    els.btnAdd = $('#btnAdd')
    els.btnArrange = $('#btnArrange')
    els.btnLayouts = $('#btnLayouts')
    els.btnTheme = $('#btnTheme')
    els.chkSnap = $('#chkSnap')
    els.chkAot = $('#chkAot')
    els.tpl = $('#tplTile')

    els.btnAdd.innerHTML = ICONS.add + '<span>افزودن کاشی</span>'
    els.btnArrange.innerHTML = ICONS.grid + '<span>چیدمان</span>'
    els.btnLayouts.innerHTML = ICONS.layout + '<span>چیدمان‌های من</span>'
    els.btnTheme.innerHTML = ICONS.moon
    $('.empty-mark').innerHTML = ICONS.empty
  }

  function applySysInfo (info) {
    const html = document.documentElement
    const theme = localStorage.getItem('pz-theme') || (info.dark ? 'dark' : 'light')
    html.setAttribute('data-theme', theme)
    html.setAttribute('data-mica', info.win11 ? '1' : '0')
    document.documentElement.style.setProperty('--accent', info.accent || '#0078d4')
    els.btnTheme.innerHTML = theme === 'dark' ? ICONS.moon : ICONS.sun
    els.btnTheme.title = theme === 'dark' ? 'تم تیره (کلیک برای روشن)' : 'تم روشن (کلیک برای تیره)'
  }

  function measureCanvas () {
    const r = els.canvas.getBoundingClientRect()
    state.canvasSize = { w: Math.round(r.width), h: Math.round(r.height) }
  }

  function rescaleIncoming (tiles, fromSize, toSize) {
    if (!fromSize.w || !fromSize.h) return
    const sx = toSize.w / fromSize.w
    const sy = toSize.h / fromSize.h
    if (!isFinite(sx) || !isFinite(sy) || (Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01)) return
    tiles.forEach((t) => {
      t.x = Math.round(t.x * sx)
      t.y = Math.round(t.y * sy)
      t.w = Math.round(t.w * sx)
      t.h = Math.round(t.h * sy)
    })
  }

  let resizeTimer = null
  function onWindowResize () {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const prev = state.canvasSize
      measureCanvas()
      if (!prev.w || !prev.h) return
      const sx = state.canvasSize.w / prev.w
      const sy = state.canvasSize.h / prev.h
      if (Math.abs(sx - 1) < .002 && Math.abs(sy - 1) < .002) return
      state.tiles.forEach((t) => {
        t.x = Math.round(t.x * sx)
        t.y = Math.round(t.y * sy)
        t.w = Math.max(MIN_W, Math.round(t.w * sx))
        t.h = Math.max(MIN_H, Math.round(t.h * sy))
        layoutTile(t)
        applyZoom(t)
      })
      persist()
    }, 150)
  }

  /* ================= ساخت/حذف کاشی ================= */
  function mountTile (data, opts) {
    opts = opts || {}
    const id = data.id || uid()
    const w = Math.max(MIN_W, Math.round(data.w || 560))
    const h = Math.max(MIN_H, Math.round(data.h || 420))
    const x = Math.round(data.x != null ? data.x : 24)
    const y = Math.round(data.y != null ? data.y : 24)
    const vw = Math.max(320, Math.round(data.vw || DEFAULT_VW))
    const url = normalizeUrl(data.url)
    const partition = data.partition || ('persist:tile-' + id)

    const node = els.tpl.content.firstElementChild.cloneNode(true)
    node.dataset.id = id
    els.canvas.appendChild(node)

    const webview = document.createElement('webview')
    webview.setAttribute('partition', partition)
    webview.setAttribute('allowpopups', '')
    webview.setAttribute('useragent', desktopUA())
    webview.src = url
    $('.tile-body', node).prepend(webview)

    const tile = { id, url, x, y, w, h, vw, title: data.title || url, partition, maxed: false, prevRect: null, el: node, webview }
    state.tiles.set(id, tile)
    state.order.push(id)

    layoutTile(tile)
    bringToFront(tile)
    wireTile(tile)
    applyZoom(tile)

    if (!opts.skipSave) persist()
    refreshEmptyState()
    return tile
  }

  function closeTile (tile) {
    state.tiles.delete(tile.id)
    state.order = state.order.filter((i) => i !== tile.id)
    tile.el.remove()
    persist()
    refreshEmptyState()
  }

  function desktopUA () {
    /* یوزرایجنت کروم دسکتاپ خالص؛ برچسب الکترون حذف می‌شود تا سایت‌ها آن را
       مرورگر معمولی تشخیص دهند. */
    return navigator.userAgent.replace(/\s*Electron\/\S+/i, '').replace(/\s*puzzletab\/\S+/i, '')
  }

  function refreshEmptyState () {
    els.empty.style.display = state.tiles.size ? 'none' : ''
  }

  /* ================= چیدمان/هندسهٔ کاشی ================= */
  function layoutTile (tile) {
    const el = tile.el
    el.style.left = tile.x + 'px'
    el.style.top = tile.y + 'px'
    el.style.width = tile.w + 'px'
    el.style.height = tile.h + 'px'
  }

  function applyZoom (tile) {
    const z = clamp(tile.w / tile.vw, 0.25, 3)
    try {
      if (tile.webview.getWebContentsId) tile.webview.setZoomFactor(z)
    } catch (_) { /* webview هنوز آماده نیست؛ در dom-ready دوباره اعمال می‌شود */ }
    tile._zoom = z
  }

  function bringToFront (tile) {
    state.order = state.order.filter((i) => i !== tile.id)
    state.order.push(tile.id)
    state.order.forEach((id, idx) => {
      const t = state.tiles.get(id)
      if (!t) return
      t.el.style.zIndex = String(10 + idx)
      t.el.classList.toggle('front', id === tile.id)
    })
  }

  /* ================= سیم‌کشی رویدادهای کاشی ================= */
  function wireTile (tile) {
    const el = tile.el
    const titleEl = $('.tile-title', el)
    const favWrap = $('.tile-fav', el)
    const favImg = $('.tile-fav img', el)
    const errLayer = $('.tile-error', el)
    const errMsg = $('.err-msg', el)
    const wv = tile.webview

    el.addEventListener('pointerdown', () => bringToFront(tile), true)

    wv.addEventListener('dom-ready', () => applyZoom(tile))
    wv.addEventListener('did-finish-load', () => applyZoom(tile))
    wv.addEventListener('did-start-loading', () => el.classList.add('loading'))
    wv.addEventListener('did-stop-loading', () => el.classList.remove('loading'))
    wv.addEventListener('page-title-updated', (e) => {
      tile.title = e.title || tile.url
      titleEl.textContent = tile.title
      titleEl.title = tile.title
      titleEl.dir = 'auto'
      persist()
    })
    wv.addEventListener('page-favicon-updated', (e) => {
      const f = e.favicons && e.favicons[0]
      if (f) { favImg.src = f; favWrap.hidden = false }
    })
    wv.addEventListener('did-navigate', (e) => {
      $('[data-act="back"]', el).disabled = !wv.canGoBack()
      $('[data-act="fwd"]', el).disabled = !wv.canGoForward()
      tile.url = e.url || tile.url
      persist()
    })
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return /* ABORTED (ناوبری جدید/کنسل) */
      el.classList.add('has-error')
      errLayer.hidden = false
      errMsg.textContent = 'بارگذاری نشد (' + (e.errorDescription || e.errorCode) + ') — ' + (e.validatedURL || '')
    })
    wv.addEventListener('did-start-navigation', () => {
      el.classList.remove('has-error')
      errLayer.hidden = true
    })

    $('[data-act="back"]', el).addEventListener('click', () => wv.goBack())
    $('[data-act="fwd"]', el).addEventListener('click', () => wv.goForward())
    $('[data-act="reload"]', el).addEventListener('click', () => wv.reload())
    $('[data-act="close"]', el).addEventListener('click', () => closeTile(tile))
    $('[data-act="more"]', el).addEventListener('click', (e) => openTileMenu(tile, e.currentTarget))
    $('[data-err="retry"]', el).addEventListener('click', () => wv.reload())
    $('[data-err="open"]', el).addEventListener('click', () => window.puzzle && window.puzzle.openExternal(wv.getURL ? wv.getURL() : tile.url))

    $('.tile-drag', el).addEventListener('dblclick', () => toggleMaximize(tile))
    wireDrag(tile)
    wireResize(tile)
  }

  function toggleMaximize (tile) {
    if (tile.maxed) {
      Object.assign(tile, tile.prevRect)
      tile.maxed = false
      tile.el.classList.remove('maxed')
    } else {
      tile.prevRect = { x: tile.x, y: tile.y, w: tile.w, h: tile.h }
      tile.x = 0; tile.y = 0
      tile.w = state.canvasSize.w; tile.h = state.canvasSize.h
      tile.maxed = true
      tile.el.classList.add('maxed')
    }
    layoutTile(tile)
    applyZoom(tile)
    bringToFront(tile)
    persist()
  }

  /* ---------- کشیدن (جابه‌جایی) ---------- */
  function wireDrag (tile) {
    const handle = $('.tile-drag', tile.el)
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return
      if (tile.maxed) return
      e.preventDefault()
      const startX = e.clientX, startY = e.clientY
      const ox = tile.x, oy = tile.y
      document.body.classList.add('interacting')
      tile.el.classList.add('dragging')
      bringToFront(tile)

      function onMove (ev) {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        let nx = ox + dx
        let ny = oy + dy
        if (state.snap) {
          const s = computeSnap(tile, nx, ny, tile.w, tile.h)
          nx = s.x; ny = s.y
          showGuides(s.guides)
        }
        nx = clamp(nx, -tile.w + 60, state.canvasSize.w - 60)
        ny = clamp(ny, 0, state.canvasSize.h - 36)
        tile.x = Math.round(nx)
        tile.y = Math.round(ny)
        layoutTile(tile)
      }
      function onUp () {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.classList.remove('interacting')
        tile.el.classList.remove('dragging')
        clearGuides()
        persist()
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    })
  }

  /* ---------- تغییر اندازه ---------- */
  function wireResize (tile) {
    $$('.rz', tile.el).forEach((handle) => {
      const dir = handle.dataset.dir
      handle.addEventListener('pointerdown', (e) => {
        if (tile.maxed) return
        e.preventDefault()
        e.stopPropagation()
        bringToFront(tile)
        const startX = e.clientX, startY = e.clientY
        const ini = { x: tile.x, y: tile.y, w: tile.w, h: tile.h }
        document.body.classList.add('interacting')
        tile.el.classList.add('resizing')

        function onMove (ev) {
          const dx = ev.clientX - startX
          const dy = ev.clientY - startY
          let { x, y, w, h } = ini
          if (dir.includes('e')) w = ini.w + dx
          if (dir.includes('s')) h = ini.h + dy
          if (dir.includes('w')) { w = ini.w - dx; x = ini.x + dx }
          if (dir.includes('n')) { h = ini.h - dy; y = ini.y + dy }

          if (w < MIN_W) { if (dir.includes('w')) x -= (MIN_W - w); w = MIN_W }
          if (h < MIN_H) { if (dir.includes('n')) y -= (MIN_H - h); h = MIN_H }

          if (state.snap) {
            const s = computeSnapResize(tile, dir, x, y, w, h)
            x = s.x; y = s.y; w = s.w; h = s.h
            showGuides(s.guides)
          }

          tile.x = Math.round(x); tile.y = Math.round(y)
          tile.w = Math.round(Math.max(MIN_W, w))
          tile.h = Math.round(Math.max(MIN_H, h))
          layoutTile(tile)
          applyZoom(tile)
        }
        function onUp () {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.body.classList.remove('interacting')
          tile.el.classList.remove('resizing')
          clearGuides()
          persist()
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
      })
    })
  }

  /* ---------- چسبیدن به لبه‌ها/شبکه ---------- */
  function edgesOf (t) { return { l: t.x, r: t.x + t.w, top: t.y, bot: t.y + t.h } }

  function computeSnap (tile, nx, ny, w, h) {
    const guides = []
    const targets = [{ l: 0, r: state.canvasSize.w, top: 0, bot: state.canvasSize.h }]
    state.tiles.forEach((t) => { if (t.id !== tile.id) targets.push(edgesOf(t)) })

    let bestX = nx, bestY = ny
    let bx = SNAP_PX, by = SNAP_PX
    const myL = nx, myR = nx + w, myT = ny, myB = ny + h

    targets.forEach((t) => {
      ;[['l', t.l], ['r', t.r]].forEach(([, v]) => {
        if (Math.abs(myL - v) < bx) { bx = Math.abs(myL - v); bestX = v; guides.push({ v: 'x', pos: v }) }
        if (Math.abs(myR - v) < bx) { bx = Math.abs(myR - v); bestX = v - w; guides.push({ v: 'x', pos: v }) }
      })
      ;[['top', t.top], ['bot', t.bot]].forEach(([, v]) => {
        if (Math.abs(myT - v) < by) { by = Math.abs(myT - v); bestY = v; guides.push({ v: 'y', pos: v }) }
        if (Math.abs(myB - v) < by) { by = Math.abs(myB - v); bestY = v - h; guides.push({ v: 'y', pos: v }) }
      })
    })
    return { x: bestX, y: bestY, guides }
  }

  function computeSnapResize (tile, dir, x, y, w, h) {
    const guides = []
    const targets = [{ l: 0, r: state.canvasSize.w, top: 0, bot: state.canvasSize.h }]
    state.tiles.forEach((t) => { if (t.id !== tile.id) targets.push(edgesOf(t)) })
    let bx = SNAP_PX, by = SNAP_PX

    if (dir.includes('e')) {
      let right = x + w
      targets.forEach((t) => {
        ;[t.l, t.r].forEach((v) => { if (Math.abs(right - v) < bx) { bx = Math.abs(right - v); right = v; guides.push({ v: 'x', pos: v }) } })
      })
      w = right - x
    }
    if (dir.includes('w')) {
      let left = x
      targets.forEach((t) => {
        ;[t.l, t.r].forEach((v) => { if (Math.abs(left - v) < bx) { bx = Math.abs(left - v); left = v; guides.push({ v: 'x', pos: v }) } })
      })
      w += x - left
      x = left
    }
    if (dir.includes('s')) {
      let bot = y + h
      targets.forEach((t) => {
        ;[t.top, t.bot].forEach((v) => { if (Math.abs(bot - v) < by) { by = Math.abs(bot - v); bot = v; guides.push({ v: 'y', pos: v }) } })
      })
      h = bot - y
    }
    if (dir.includes('n')) {
      let top = y
      targets.forEach((t) => {
        ;[t.top, t.bot].forEach((v) => { if (Math.abs(top - v) < by) { by = Math.abs(top - v); top = v; guides.push({ v: 'y', pos: v }) } })
      })
      h += y - top
      y = top
    }
    return { x, y, w, h, guides }
  }

  let guideEls = []
  function showGuides (guides) {
    clearGuides()
    const seen = new Set()
    guides.forEach((g) => {
      const key = g.v + g.pos
      if (seen.has(key)) return
      seen.add(key)
      const d = document.createElement('div')
      d.className = 'guide ' + (g.v === 'x' ? 'v' : 'h')
      if (g.v === 'x') d.style.left = g.pos + 'px'
      else d.style.top = g.pos + 'px'
      els.canvas.appendChild(d)
      guideEls.push(d)
    })
  }
  function clearGuides () { guideEls.forEach((d) => d.remove()); guideEls = [] }

  /* ================= چیدمان خودکار ================= */
  function arrangeGrid (cols) {
    const ids = state.order.slice()
    const n = ids.length
    if (!n) return
    cols = clamp(cols, 1, n)
    const rows = Math.ceil(n / cols)
    const cw = (state.canvasSize.w - GAP * (cols + 1)) / cols
    const ch = (state.canvasSize.h - GAP * (rows + 1)) / rows
    ids.forEach((id, i) => {
      const t = state.tiles.get(id)
      if (!t) return
      const col = i % cols
      const row = Math.floor(i / cols)
      t.maxed = false
      t.el.classList.remove('maxed')
      t.x = Math.round(GAP + col * (cw + GAP))
      t.y = Math.round(GAP + row * (ch + GAP))
      t.w = Math.round(cw)
      t.h = Math.round(ch)
      layoutTile(t)
      applyZoom(t)
    })
    persist()
  }

  function arrangeRow () { arrangeGrid(state.order.length || 1) }
  function arrangeCascade () {
    const ids = state.order.slice()
    const n = ids.length
    if (!n) return
    const w = Math.round(state.canvasSize.w * 0.62)
    const h = Math.round(state.canvasSize.h * 0.72)
    const stepX = Math.min(46, Math.max(18, (state.canvasSize.w - w) / Math.max(1, n)))
    const stepY = Math.min(40, Math.max(16, (state.canvasSize.h - h) / Math.max(1, n)))
    ids.forEach((id, i) => {
      const t = state.tiles.get(id)
      if (!t) return
      t.maxed = false
      t.el.classList.remove('maxed')
      t.w = w; t.h = h
      t.x = Math.round(GAP + i * stepX) % Math.max(1, (state.canvasSize.w - w))
      t.y = Math.round(GAP + i * stepY) % Math.max(1, (state.canvasSize.h - h))
      layoutTile(t)
      applyZoom(t)
    })
    reorderByCreation()
    persist()
  }
  function reorderByCreation () {
    state.order.forEach((id, idx) => {
      const t = state.tiles.get(id)
      if (t) t.el.style.zIndex = String(10 + idx)
    })
  }

  /* ================= منوها (پاپ‌آور) ================= */
  let openMenuEl = null
  function closeMenu () {
    if (openMenuEl) { openMenuEl.remove(); openMenuEl = null }
    document.removeEventListener('pointerdown', onOutsideMenuClick, true)
    document.removeEventListener('keydown', onMenuEsc, true)
  }
  function onOutsideMenuClick (e) {
    if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu()
  }
  function onMenuEsc (e) { if (e.key === 'Escape') closeMenu() }

  function openMenuNear (anchor, buildFn, opts) {
    closeMenu()
    const menu = document.createElement('div')
    menu.className = 'menu' + (opts && opts.cls ? ' ' + opts.cls : '')
    buildFn(menu)
    document.body.appendChild(menu)
    positionMenu(menu, anchor)
    openMenuEl = menu
    setTimeout(() => {
      document.addEventListener('pointerdown', onOutsideMenuClick, true)
      document.addEventListener('keydown', onMenuEsc, true)
    }, 0)
    return menu
  }

  function positionMenu (menu, anchor) {
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor
    const mw = menu.offsetWidth || 260
    const mh = menu.offsetHeight || 200
    let left = r.left
    let top = r.bottom + 6
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6)
    menu.style.left = Math.max(8, left) + 'px'
    menu.style.top = top + 'px'
  }

  function menuItem (opts) {
    const b = document.createElement('button')
    b.className = 'menu-item' + (opts.danger ? ' danger' : '')
    b.innerHTML =
      (opts.icon ? '<span class="mi-ic">' + opts.icon + '</span>' : '') +
      '<span class="mi-t"></span>' +
      (opts.hint ? '<span class="mi-hint"></span>' : '') +
      (opts.checked ? '<span class="mi-check">' + ICONS.check + '</span>' : '')
    $('.mi-t', b).textContent = opts.label
    if (opts.hint) $('.mi-hint', b).textContent = opts.hint
    b.addEventListener('click', () => { opts.onClick && opts.onClick(); if (opts.keepOpen !== true) closeMenu() })
    return b
  }

  function menuSep () { const d = document.createElement('div'); d.className = 'menu-sep'; return d }

  /* ---------- منوی «افزودن کاشی» ---------- */
  function openAddMenu (anchor) {
    const menu = openMenuNear(anchor, (menu) => {
      menu.classList.add('add-menu')
      const label1 = document.createElement('div')
      label1.className = 'fm-label'
      label1.textContent = 'نشانی سایت'
      menu.appendChild(label1)

      const row1 = document.createElement('div')
      row1.className = 'fm-row'
      const input = document.createElement('input')
      input.className = 'text'
      input.placeholder = 'مثلاً t.me یا https://example.com'
      input.id = 'addUrlInput'
      input.dir = 'ltr'
      input.style.textAlign = 'right'
      row1.appendChild(input)
      menu.appendChild(row1)

      const label2 = document.createElement('div')
      label2.className = 'fm-label'
      label2.textContent = 'اندازهٔ نمای دسکتاپ (عرض مجازی)'
      menu.appendChild(label2)
      const row2 = document.createElement('div')
      row2.className = 'fm-row'
      const select = document.createElement('select')
      select.className = 'text'
      VW_PRESETS.forEach((p) => {
        const o = document.createElement('option')
        o.value = String(p.v); o.textContent = p.l
        if (p.v === DEFAULT_VW) o.selected = true
        select.appendChild(o)
      })
      row2.appendChild(select)
      const go = document.createElement('button')
      go.className = 'btn primary'
      go.textContent = 'افزودن'
      row2.appendChild(go)
      menu.appendChild(row2)

      const submit = () => {
        const raw = input.value.trim()
        if (!raw) { input.classList.add('shake'); input.focus(); setTimeout(() => input.classList.remove('shake'), 400); return }
        addTileCascade(normalizeUrl(raw), Number(select.value) || DEFAULT_VW)
        closeMenu()
      }
      go.addEventListener('click', submit)
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })

      const label3 = document.createElement('div')
      label3.className = 'fm-label'
      label3.textContent = 'میانبرهای رایج'
      menu.appendChild(label3)
      const grid = document.createElement('div')
      grid.className = 'quick-grid'
      renderQuickChips(grid, (site) => { addTileCascade(site.u, site.vw); closeMenu() })
      menu.appendChild(grid)

      const hint = document.createElement('div')
      hint.className = 'fm-hint'
      hint.style.marginTop = '10px'
      hint.textContent = 'هر کاشی ورودِ (کوکی) جدا دارد؛ یعنی می‌تونی مثلاً دو حساب تلگرام/جیمیل متفاوت را همزمان در دو کاشی باز نگه داری.'
      menu.appendChild(hint)

      setTimeout(() => input.focus(), 10)
    }, { cls: 'add-menu' })
    return menu
  }

  function renderQuickChips (container, onPick) {
    QUICK_SITES.forEach((site) => {
      const b = document.createElement('button')
      b.className = 'quick'
      b.innerHTML = '<span class="q-ic">' + site.t[0] + '</span><span></span>'
      b.querySelector('span:last-child').textContent = site.t
      b.querySelector('.q-ic').style.background = site.c
      b.addEventListener('click', () => onPick(site))
      container.appendChild(b)
    })
  }

  function addTileCascade (url, vw) {
    const n = state.tiles.size
    const ox = 28 + (n % 6) * 30
    const oy = 28 + (n % 6) * 26
    const w = clamp(Math.round(state.canvasSize.w * 0.46), MIN_W, state.canvasSize.w - 40)
    const h = clamp(Math.round(state.canvasSize.h * 0.56), MIN_H, state.canvasSize.h - 40)
    mountTile({ x: ox, y: oy, w, h, vw: vw || DEFAULT_VW, url })
  }

  /* ---------- منوی «چیدمان» ---------- */
  function openArrangeMenu (anchor) {
    openMenuNear(anchor, (menu) => {
      const items = [
        { label: 'یک ستون (همه تمام‌صفحه، پشت‌سرهم)', run: () => arrangeGrid(1) },
        { label: 'دو ستون', run: () => arrangeGrid(2) },
        { label: 'سه ستون', run: () => arrangeGrid(3) },
        { label: 'شبکهٔ ۲×۲', run: () => arrangeGrid(2) },
        { label: 'ردیفی (کنار هم)', run: () => arrangeRow() },
        { label: 'آبشاری (روی هم، پلکانی)', run: () => arrangeCascade() }
      ]
      items.forEach((it) => menu.appendChild(menuItem({ label: it.label, icon: ICONS.grid, onClick: it.run })))
    })
  }

  /* ---------- منوی «چیدمان‌های من» ---------- */
  function openLayoutsMenu (anchor) {
    openMenuNear(anchor, (menu) => {
      menu.appendChild(menuItem({
        label: 'ذخیرهٔ چیدمان فعلی…',
        icon: ICONS.add,
        onClick: () => promptSaveLayout()
      }))
      menu.appendChild(menuSep())
      if (!state.layouts.length) {
        const d = document.createElement('div')
        d.className = 'menu-empty'
        d.textContent = 'هنوز چیدمانی ذخیره نکرده‌ای.'
        menu.appendChild(d)
      } else {
        state.layouts.forEach((lo, idx) => {
          const item = menuItem({
            label: lo.name,
            hint: lo.tiles.length + ' کاشی',
            icon: ICONS.layout,
            keepOpen: true,
            onClick: () => { applyLayout(lo); closeMenu() }
          })
          const del = document.createElement('button')
          del.className = 'menu-del'
          del.title = 'حذف این چیدمان'
          del.innerHTML = ICONS.trash
          del.addEventListener('click', (e) => {
            e.stopPropagation()
            state.layouts.splice(idx, 1)
            persist()
            closeMenu()
            openLayoutsMenu(anchor)
          })
          item.appendChild(del)
          menu.appendChild(item)
        })
      }
    })
  }

  function promptSaveLayout () {
    const back = document.createElement('div')
    back.className = 'modal-back'
    back.innerHTML =
      '<div class="modal">' +
      '<h3>ذخیرهٔ چیدمان</h3>' +
      '<div class="modal-body">یک نام برای این چیدمان بگذار تا بعداً بتوانی دوباره بارش کنی.</div>' +
      '<input class="text" id="layoutName" placeholder="مثلاً «کار روزانه»">' +
      '<div class="modal-actions">' +
      '<button class="btn" id="layoutCancel">انصراف</button>' +
      '<button class="btn primary" id="layoutSave">ذخیره</button>' +
      '</div></div>'
    document.body.appendChild(back)
    const input = $('#layoutName', back)
    input.focus()
    const close = () => back.remove()
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close() })
    $('#layoutCancel', back).addEventListener('click', close)
    const save = () => {
      const name = input.value.trim() || ('چیدمان ' + (state.layouts.length + 1))
      state.layouts.push(snapshotLayout(name))
      persist()
      close()
      toast('چیدمان «' + name + '» ذخیره شد')
    }
    $('#layoutSave', back).addEventListener('click', save)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save() })
  }

  function snapshotLayout (name) {
    return {
      name,
      canvasSize: { ...state.canvasSize },
      tiles: state.order.map((id) => {
        const t = state.tiles.get(id)
        return { url: t.url, x: t.x, y: t.y, w: t.w, h: t.h, vw: t.vw, title: t.title }
      })
    }
  }

  function applyLayout (lo) {
    state.tiles.forEach((t) => t.el.remove())
    state.tiles.clear()
    state.order = []
    const tiles = lo.tiles.map((t) => ({ ...t }))
    if (lo.canvasSize && lo.canvasSize.w && lo.canvasSize.h) rescaleIncoming(tiles, lo.canvasSize, state.canvasSize)
    tiles.forEach((t) => mountTile(t))
    refreshEmptyState()
  }

  /* ---------- منوی هر کاشی («بیشتر») ---------- */
  function openTileMenu (tile, anchor) {
    openMenuNear(anchor, (menu) => {
      menu.appendChild(menuItem({ label: tile.maxed ? 'بازگردانی اندازه' : 'بیشینه‌کردن', icon: ICONS.maximize, onClick: () => toggleMaximize(tile) }))
      menu.appendChild(menuItem({ label: 'تکثیر کاشی (نشست مستقل جدید)', icon: ICONS.copy, onClick: () => duplicateTile(tile) }))
      menu.appendChild(menuItem({ label: 'باز کردن در مرورگر پیش‌فرض', icon: ICONS.external, onClick: () => window.puzzle && window.puzzle.openExternal(tile.webview.getURL ? tile.webview.getURL() : tile.url) }))
      menu.appendChild(menuSep())

      const sizeLabel = document.createElement('div')
      sizeLabel.className = 'fm-label'
      sizeLabel.style.padding = '2px 10px'
      sizeLabel.textContent = 'اندازهٔ نمای دسکتاپِ این کاشی'
      menu.appendChild(sizeLabel)
      VW_PRESETS.forEach((p) => {
        menu.appendChild(menuItem({
          label: p.l,
          checked: tile.vw === p.v,
          onClick: () => { tile.vw = p.v; applyZoom(tile); persist() }
        }))
      })
      menu.appendChild(menuSep())
      menu.appendChild(menuItem({
        label: 'پاک‌کردن کوکی/ورود این کاشی',
        icon: ICONS.trash,
        onClick: async () => {
          if (window.puzzle) await window.puzzle.clearTileSession(tile.partition)
          tile.webview.reload()
          toast('نشست این کاشی پاک شد')
        }
      }))
      menu.appendChild(menuItem({ label: 'بستن کاشی', icon: ICONS.close, danger: true, onClick: () => closeTile(tile) }))
    })
  }

  function duplicateTile (tile) {
    mountTile({ url: tile.url, x: tile.x + 26, y: tile.y + 26, w: tile.w, h: tile.h, vw: tile.vw })
  }

  /* ================= نوار ابزار ================= */
  function wireToolbar () {
    els.btnAdd.addEventListener('click', (e) => openAddMenu(e.currentTarget))
    els.btnArrange.addEventListener('click', (e) => openArrangeMenu(e.currentTarget))
    els.btnLayouts.addEventListener('click', (e) => openLayoutsMenu(e.currentTarget))

    els.chkSnap.checked = true
    els.chkSnap.addEventListener('change', () => { state.snap = els.chkSnap.checked })
    state.snap = true

    els.chkAot.addEventListener('change', () => { if (window.puzzle) window.puzzle.setAlwaysOnTop(els.chkAot.checked) })

    els.btnTheme.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme')
      const next = cur === 'dark' ? 'light' : 'dark'
      localStorage.setItem('pz-theme', next)
      document.documentElement.setAttribute('data-theme', next)
      els.btnTheme.innerHTML = next === 'dark' ? ICONS.moon : ICONS.sun
    })
  }

  function wireEmptyQuick () {
    renderQuickChips(els.emptyQuick, (site) => addTileCascade(site.u, site.vw))
  }

  function wireGlobalPointer () {
    /* کلیک روی بوم (پس‌زمینه) هیچ کاشی‌ای را فوکوس نمی‌کند؛ فقط برای آینده */
  }

  /* ================= ماندگاری (ذخیره‌سازی) ================= */
  let saveTimer = null
  function persist () {
    if (!window.puzzle) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const data = {
        canvasSize: { ...state.canvasSize },
        tiles: state.order.map((id) => {
          const t = state.tiles.get(id)
          return { id: t.id, url: t.url, x: t.x, y: t.y, w: t.w, h: t.h, vw: t.vw, title: t.title, partition: t.partition }
        }),
        layouts: state.layouts
      }
      window.puzzle.saveStore(data)
    }, 260)
  }

  /* ================= توست ================= */
  let toastTimer = null
  function toast (msg) {
    let el = $('.toast')
    if (!el) {
      el = document.createElement('div')
      el.className = 'toast'
      document.body.appendChild(el)
    }
    el.textContent = msg
    requestAnimationFrame(() => el.classList.add('show'))
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
  }

  /* ================= API تست (استفادهٔ main.js در --selftest) ================= */
  function buildTestApi () {
    return {
      addTile: (url, geom) => mountTile({ url, ...geom }),
      info: () => state.order.map((id) => {
        const t = state.tiles.get(id)
        return { id: t.id, x: t.x, y: t.y, w: t.w, h: t.h, vw: t.vw, title: t.title, zoom: t._zoom }
      }),
      canvasRect: () => {
        const r = els.canvas.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      },
      pointer: (selector, type, x, y) => {
        const el = document.querySelector(selector)
        if (!el) { console.log('pointer(): NOT FOUND', selector); return false }
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, view: window }
        el.dispatchEvent(new PointerEvent(type, opts))
        return true
      },
      openMenu: () => openAddMenu(els.btnAdd),
      closeMenu: () => closeMenu(),
      arrange: (cols) => arrangeGrid(cols),
      viewports: async () => {
        const out = []
        for (const id of state.order) {
          const t = state.tiles.get(id)
          try {
            const r = await t.webview.executeJavaScript('({w: window.innerWidth, h: window.innerHeight})')
            out.push({ id: t.id, w: r.w, h: r.h, tileW: t.w, vw: t.vw, zoom: t._zoom })
          } catch (e) {
            out.push({ id: t.id, error: String(e) })
          }
        }
        return out
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
