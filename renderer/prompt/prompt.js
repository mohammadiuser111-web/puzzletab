'use strict'
;(function () {
  const input = document.getElementById('proc')
  const ok = () => { const v = (input.value || '').trim(); if (v) window.puzzlePrompt.submit(v) }
  const cancel = () => window.puzzlePrompt.cancel()
  document.getElementById('btnOk').addEventListener('click', ok)
  document.getElementById('btnCancel').addEventListener('click', cancel)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ok()
    else if (e.key === 'Escape') cancel()
  })
  window.addEventListener('DOMContentLoaded', () => input.focus())
})()
