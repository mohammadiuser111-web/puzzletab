'use strict'
/* پازل‌تب — پل امن بین صفحه و فرایند اصلی */

const { contextBridge, ipcRenderer } = require('electron')

const api = {
  /* اطلاعات سیستم: تم تیره/روشن، رنگ اکسنت، ویندوز ۱۱؟ */
  info: () => ipcRenderer.invoke('sys:info'),
  onTheme: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('sys:theme', handler)
    return () => ipcRenderer.removeListener('sys:theme', handler)
  },
  /* ذخیره‌سازی */
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  /* باز کردن نشانی در مرورگر پیش‌فرض */
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  /* همیشه روی صفحه */
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:aot', v),
  /* پاک‌کردن کوکی/ورود یک کاشی (بر اساس partition آن) */
  clearTileSession: (partition) => ipcRenderer.invoke('tile:clear-session', partition)
}

try {
  contextBridge.exposeInMainWorld('puzzle', api)
} catch (e) {
  console.error('preload failed:', e)
}
