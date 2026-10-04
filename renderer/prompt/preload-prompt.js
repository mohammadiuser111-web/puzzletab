'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('puzzlePrompt', {
  submit: (value) => ipcRenderer.send('prompt:submit', value),
  cancel: () => ipcRenderer.send('prompt:cancel')
})
