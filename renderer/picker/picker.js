'use strict'
;(function () {
  const $ = (s, r) => (r || document).querySelector(s)
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))

  const els = {}
  let windows = []
  const selected = new Set()

  function cache () {
    els.list = $('#list')
    els.search = $('#search')
    els.btnRefresh = $('#btnRefresh')
    els.btnClose = $('#btnClose')
    els.btnCancel = $('#btnCancel')
    els.btnGo = $('#btnGo')
    els.count = $('#countLabel')
  }

  async function applyTheme () {
    try {
      const info = await window.puzzle.info()
      document.documentElement.setAttribute('data-theme', info.dark ? 'dark' : 'light')
    } catch (_) {}
  }

  async function load () {
    els.list.innerHTML = '<div class="loading">در حال خواندن پنجره‌های باز…</div>'
    let res
    try { res = await window.puzzle.winList() } catch (e) { res = { ok: false, error: String(e) } }
    if (!res || !res.ok) {
      els.list.innerHTML = '<div class="empty">خواندن لیست پنجره‌ها ناموفق بود'
        + (res && res.error ? ('<br><small>' + escapeHtml(res.error) + '</small>') : '') + '</div>'
      return
    }
    windows = res.windows || []
    render()
  }

  function escapeHtml (s) {
    const d = document.createElement('div')
    d.textContent = String(s)
    return d.innerHTML
  }

  function render () {
    const q = (els.search.value || '').trim().toLowerCase()
    const items = windows.filter((w) => !q || (w.title || '').toLowerCase().includes(q) || (w.process || '').toLowerCase().includes(q))
    if (!items.length) {
      els.list.innerHTML = '<div class="empty">پنجره‌ای پیدا نشد.</div>'
      return
    }
    els.list.innerHTML = ''
    items.forEach((w) => {
      const row = document.createElement('div')
      row.className = 'row'
      const iconHtml = w.icon ? '<img src="data:image/png;base64,' + w.icon + '">' : '🗔'
      row.innerHTML =
        '<input type="checkbox">' +
        '<span class="ic">' + iconHtml + '</span>' +
        '<span class="meta"><div class="ttl"></div><div class="proc"></div></span>'
      $('.ttl', row).textContent = w.title || '(بدون عنوان)'
      $('.proc', row).textContent = w.process || ''
      const cb = $('input', row)
      cb.checked = selected.has(w.handle)
      const toggle = () => {
        if (selected.has(w.handle)) selected.delete(w.handle)
        else selected.add(w.handle)
        cb.checked = selected.has(w.handle)
        updateFooter()
      }
      row.addEventListener('click', (e) => { if (e.target !== cb) toggle() })
      cb.addEventListener('click', (e) => { e.stopPropagation(); toggle() })
      els.list.appendChild(row)
    })
  }

  function updateFooter () {
    els.count.textContent = selected.size + ' انتخاب شده'
    els.btnGo.disabled = selected.size === 0
  }

  function wire () {
    els.search.addEventListener('input', render)
    els.btnRefresh.addEventListener('click', load)
    els.btnClose.addEventListener('click', () => window.close())
    els.btnCancel.addEventListener('click', () => window.close())
    els.btnGo.addEventListener('click', () => {
      window.puzzle.openOverlayWithHandles(Array.from(selected))
    })
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close() })
  }

  async function init () {
    cache()
    wire()
    await applyTheme()
    await load()
  }

  document.addEventListener('DOMContentLoaded', init)
})()
