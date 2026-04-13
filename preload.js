const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  ipc: {
    on: (channel, cb) => ipcRenderer.on(channel, (e, data) => cb(data)),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  }
});
