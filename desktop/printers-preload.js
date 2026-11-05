// the Printers window talks to the program through these few calls only
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('printers', {
  list: () => ipcRenderer.invoke('printers:list'),
  choose: (kind, name) => ipcRenderer.invoke('printers:choose', kind, name),
  a5Text: (on) => ipcRenderer.invoke('printers:a5text', on),
  test: (kind) => ipcRenderer.invoke('printers:test', kind)
});
