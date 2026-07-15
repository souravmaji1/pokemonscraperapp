const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startScraper: (config) => ipcRenderer.invoke('start-scraper', config),
  onLogMessage: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('scraper-log', handler);
    return () => ipcRenderer.removeListener('scraper-log', handler);
  },
  // Add method to take screenshot of offscreen window (optional)
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot')
});