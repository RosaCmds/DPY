const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pet', Object.freeze({
  state: () => ipcRenderer.invoke('pet:state'),
  connection: input => ipcRenderer.invoke('pet:connection', input),
  workbuddyLogin: () => ipcRenderer.invoke('pet:workbuddy-login'),
  workbuddyModels: () => ipcRenderer.invoke('pet:workbuddy-models'),
  signin: () => ipcRenderer.invoke('pet:signin'),
  cancel: () => ipcRenderer.invoke('pet:cancel'),
  model: value => ipcRenderer.invoke('pet:model', value),
  refresh: () => ipcRenderer.invoke('pet:refresh'),
  test: () => ipcRenderer.invoke('pet:test'),
  usage: () => ipcRenderer.invoke('pet:usage'),
  updateCheck: () => ipcRenderer.invoke('pet:update-check'),
  updateDownload: () => ipcRenderer.invoke('pet:update-download'),
  updateInstall: () => ipcRenderer.invoke('pet:update-install'),
  updateSource: () => ipcRenderer.invoke('pet:update-source'),
  quit: () => ipcRenderer.invoke('pet:quit'),
}));
