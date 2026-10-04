'use strict'
/* پازل‌تب — پل امن بین صفحات (کاشی داخلی/Picker/Overlay) و فرایند اصلی */

const { contextBridge, ipcRenderer } = require('electron')

const api = {
  /* اطلاعات سیستم */
  info: () => ipcRenderer.invoke('sys:info'),
  onTheme: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('sys:theme', handler)
    return () => ipcRenderer.removeListener('sys:theme', handler)
  },
  /* ذخیره‌سازی عمومی (حالت کاشی داخلی) */
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:aot', v),
  clearTileSession: (partition) => ipcRenderer.invoke('tile:clear-session', partition),

  /* کنترل پنجره‌های واقعی ویندوز */
  winList: () => ipcRenderer.invoke('winctl:list'),
  winRect: (handle) => ipcRenderer.invoke('winctl:rect', handle),
  winMove: (items) => ipcRenderer.invoke('winctl:move', items),
  winZoom: (handle, steps) => ipcRenderer.invoke('winctl:zoom', handle, steps),
  winFocus: (handle) => ipcRenderer.invoke('winctl:focus', handle),
  winMinimize: (handle) => ipcRenderer.invoke('winctl:minimize', handle),

  /* چیدمان مدیریت‌شده (پایدار) */
  loadManaged: () => ipcRenderer.invoke('managed:load'),
  saveManaged: (data) => ipcRenderer.invoke('managed:save', data),

  screensBounds: () => ipcRenderer.invoke('screens:bounds'),

  /* کنترل پنجرهٔ Picker/Overlay */
  openOverlayWithHandles: (handles) => ipcRenderer.invoke('overlay:openWithHandles', handles),
  closeOverlay: () => ipcRenderer.invoke('overlay:close'),
  openPicker: () => ipcRenderer.invoke('picker:open'),
  onOverlaySeed: (cb) => {
    const handler = (_e, handles) => cb(handles)
    ipcRenderer.on('overlay:seed', handler)
    return () => ipcRenderer.removeListener('overlay:seed', handler)
  }
}

try {
  contextBridge.exposeInMainWorld('puzzle', api)
} catch (e) {
  console.error('preload failed:', e)
}
