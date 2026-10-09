const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  pickDbPath: () => ipcRenderer.invoke('config:pickDbPath'),
  initDb: () => ipcRenderer.invoke('db:init'),
  getAllDays: () => ipcRenderer.invoke('db:getAllDays'),
  upsertDay: (record, overwrite) => ipcRenderer.invoke('db:upsertDay', record, overwrite),
  checkExists: (dateKey) => ipcRenderer.invoke('db:checkExists', dateKey),
  readCsvFile: (filePath) => ipcRenderer.invoke('file:readCsv', filePath),
  fetchCaisoDay: (dateStr, nodeId) => ipcRenderer.invoke('caiso:fetchDay', dateStr, nodeId),
  fetchCaisoRange: (startDateStr, endDateStr, nodeId) => ipcRenderer.invoke('caiso:fetchRange', startDateStr, endDateStr, nodeId),
  onFetchProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('caiso:fetchProgress', listener);
    return () => ipcRenderer.removeListener('caiso:fetchProgress', listener);
  }
});