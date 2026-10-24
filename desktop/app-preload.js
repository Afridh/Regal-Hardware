// the till page asks the program through this one call only: "look for a new version of Regal POS now"
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('regalApp', {
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate')
});
