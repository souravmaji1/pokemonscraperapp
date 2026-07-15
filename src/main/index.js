const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { join } = require('path');
const path = require('path');

// Remove the default File/Edit/View/Window/Help menu bar
Menu.setApplicationMenu(null);

let mainWindow;
let offscreenWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
    },
    icon: join(__dirname, '../../resources/icon.png'),
    title: 'Target Scraper Bot',
    show: true, // Make sure main window is visible
  });

  // In development, load from Vite dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle any renderer crashes
  mainWindow.webContents.on('crashed', (event) => {
    console.error('Renderer process crashed');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorDescription);
  });
}

// Function to create offscreen window for scraping
function createOffscreenWindow(url) {
  // Destroy existing offscreen window if any
  if (offscreenWindow) {
    offscreenWindow.destroy();
    offscreenWindow = null;
  }

  offscreenWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false, // Don't show this window
    webPreferences: {
      offscreen: true, // Enable offscreen rendering
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    }
  });

  return offscreenWindow;
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Helper function to send logs to renderer
function sendLogToRenderer(logData) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('scraper-log', logData);
    } catch (error) {
      console.error('Failed to send log to renderer:', error);
    }
  }
}

// Handle scraper execution using Puppeteer (simplified)
ipcMain.handle('start-scraper', async (event, config) => {
  try {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: 'Starting scraper...',
      type: 'info'
    });
    
    // Import and run scraper
    const { runScraper } = require('../../scraper');
    
    // Set up logging
    global.sendLogToRenderer = sendLogToRenderer;
    
    const result = await runScraper(config);
    
    if (result.success) {
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: '✅ Scraper completed successfully!',
        type: 'success'
      });
    } else {
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: '❌ Scraper did not complete successfully.',
        type: 'error'
      });
    }
    
    return { success: true, data: result };
  } catch (error) {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: `Error: ${error.message}`,
      type: 'error'
    });
    return { success: false, error: error.message };
  }
});

// Export sendLogToRenderer for use in scraper module
global.sendLogToRenderer = sendLogToRenderer;