// the till page asks the program through these calls only: "look for a new version of Regal POS now", and
// "open the Printers window" (the Menu's Printers button — Ctrl+Shift+P was the only way in)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('regalApp', {
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openPrinters: () => ipcRenderer.invoke('app:openPrinters')
});
