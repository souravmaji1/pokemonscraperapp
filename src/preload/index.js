const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startMonitoring: (config) => ipcRenderer.invoke('start-monitoring', config),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  stopCheckout: (url) => ipcRenderer.invoke('stop-checkout', url),
  onLogMessage: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('scraper-log', handler);
    return () => ipcRenderer.removeListener('scraper-log', handler);
  },
  onProductStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('product-status', handler);
    return () => ipcRenderer.removeListener('product-status', handler);
  },
});