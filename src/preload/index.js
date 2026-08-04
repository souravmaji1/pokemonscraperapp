const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startMonitoring: (config) => ipcRenderer.invoke('start-monitoring', config),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  stopCheckout: (url) => ipcRenderer.invoke('stop-checkout', url),
  startTwitterMonitor: (config) => ipcRenderer.invoke('start-twitter-monitor', config),
  stopTwitterMonitor: () => ipcRenderer.invoke('stop-twitter-monitor'),
    // Profile persistence
  saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
  loadProfile: () => ipcRenderer.invoke('load-profile'),
  deleteProfile: () => ipcRenderer.invoke('delete-profile'),
  hasProfile: () => ipcRenderer.invoke('has-profile'),

   // Product persistence
  saveProducts: (products) => ipcRenderer.invoke('save-products', products),
  loadProducts: () => ipcRenderer.invoke('load-products'),
  clearProducts: () => ipcRenderer.invoke('clear-products'),

  
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