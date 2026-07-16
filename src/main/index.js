const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { join } = require('path');

Menu.setApplicationMenu(null);

let mainWindow;
const activeMonitors = new Map(); // url -> { stop }
const activeCheckouts = new Map(); // url -> puppeteer browser instance


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
    show: true,
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('crashed', () => console.error('Renderer process crashed'));
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorDescription);
  });
}

function createOffscreenWindow() {
  return new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, webSecurity: true }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function sendLogToRenderer(logData) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('scraper-log', logData); } catch (error) {
      console.error('Failed to send log to renderer:', error);
    }
  }
}

function sendProductStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('product-status', data); } catch {}
  }
}

global.sendLogToRenderer = sendLogToRenderer;


// config = { profile: {...}, productUrls: [{url, name}], headless }
ipcMain.handle('start-monitoring', async (event, config) => {
  const { monitorProduct } = require('../../monitor');
  const { runScraper } = require('../../scraper');

  const started = [];

  for (const product of config.productUrls) {
    if (activeMonitors.has(product.url)) continue;

    sendProductStatus({ url: product.url, status: 'monitoring' });

    const handle = await monitorProduct(product.url, product.name, {
      onLog: sendLogToRenderer,
      onInStock: async ({ url, name, price }) => {
        activeMonitors.delete(url);
        sendProductStatus({ url, status: 'buying', price });

          if (!config.profile) {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: `[${name}] ❌ No profile saved — can't checkout. Save your profile first.`,
      type: 'error'
    });
    sendProductStatus({ url, status: 'checkout-failed' });
    return;
  }

        sendLogToRenderer({
          timestamp: new Date().toISOString(),
          message: `[${name}] 🛒 In stock at ${price} — starting checkout...`,
          type: 'info'
        });

        const checkoutConfig = {
          ...config.profile,
          productUrl: url,
          headless: config.headless,
          args: config.profile.args,
        };

        const result = await runScraper(checkoutConfig, (browser) => {
    activeCheckouts.set(url, browser);
  });

  activeCheckouts.delete(url);

          const status = result.success ? 'purchased' : (result.stopped ? 'stopped' : 'checkout-failed');
  sendProductStatus({ url, status });
        sendLogToRenderer({
    timestamp: new Date().toISOString(),
    message: result.success
      ? `[${name}] ✅ Checkout completed!`
      : `[${name}] ${result.stopped ? '🛑' : '❌'} ${result.stopped ? 'Checkout stopped by user.' : `Checkout did not complete: ${result.error || 'see logs above'}`}`,
    type: result.success ? 'success' : (result.stopped ? 'warning' : 'error')
  });

      }
    });

    activeMonitors.set(product.url, handle);
    started.push(product.url);
  }

  return { success: true, monitoring: started };
});

// New IPC handler: stop a specific in-progress checkout
ipcMain.handle('stop-checkout', async (event, url) => {
  const browser = activeCheckouts.get(url);
  if (browser) {
    try { await browser.close(); } catch {}
    activeCheckouts.delete(url);
    return { success: true };
  }
  return { success: false, error: 'No active checkout for this URL' };
});

// Updated stop-monitoring: also stop any in-progress checkouts
ipcMain.handle('stop-monitoring', async () => {
  for (const [url, handle] of activeMonitors) {
    handle.stop();
    sendProductStatus({ url, status: 'stopped' });
  }
  activeMonitors.clear();

  for (const [url, browser] of activeCheckouts) {
    try { await browser.close(); } catch {}
    sendProductStatus({ url, status: 'stopped' });
  }
  activeCheckouts.clear();

  return { success: true };
});