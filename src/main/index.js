const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { join } = require('path');

const isMac = process.platform === 'darwin';

const menuTemplate = [
  ...(isMac ? [{
    label: app.getName(),
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  }] : []),
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac ? [
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ] : [
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ])
    ]
  }
];

Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

let mainWindow;
const activeMonitors = new Map(); // url -> { stop, platform }
const activeCheckouts = new Map(); // url -> puppeteer browser instance

// Try to require the modules - they might be in different locations
let monitorTargetProduct, monitorPokemonProduct, runTargetScraper, runPokemonScraper;

try {
  const targetMonitor = require('../../monitor-target');
  monitorTargetProduct = targetMonitor.monitorTargetProduct;
} catch (e) {
  console.error('Failed to load monitor-target:', e.message);
}

try {
  const pokemonMonitor = require('../../monitor-pokemon');
  monitorPokemonProduct = pokemonMonitor.monitorPokemonProduct;
} catch (e) {
  console.error('Failed to load monitor-pokemon:', e.message);
}

try {
  const targetScraper = require('../../scraper-target');
  runTargetScraper = targetScraper.runScraper || targetScraper.runTargetScraper;
} catch (e) {
  console.error('Failed to load scraper-target:', e.message);
}

try {
  const pokemonScraper = require('../../scraper-pokemon');
  runPokemonScraper = pokemonScraper.runScraper || pokemonScraper.runPokemonScraper;
} catch (e) {
  console.error('Failed to load scraper-pokemon:', e.message);
}

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
    title: 'Multi-Platform Scraper Bot',
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

// Helper to merge platform profiles with common profile
function getCheckoutConfig(commonProfile, platform, productUrl) {
  const baseConfig = {
    productUrl,
    headless: commonProfile.headless,
  };

  if (platform === 'target') {
    return {
      ...baseConfig,
      email: commonProfile.target?.email || commonProfile.email,
      password: commonProfile.target?.password || commonProfile.password,
      shipping: commonProfile.target?.shipping || commonProfile.shipping,
      card: commonProfile.target?.card || commonProfile.card,
    };
  } else if (platform === 'pokemon') {
    return {
      ...baseConfig,
      email: commonProfile.pokemon?.email || commonProfile.email,
      password: commonProfile.pokemon?.password || commonProfile.password,
      shipping: {
        givenName: commonProfile.pokemon?.shipping?.givenName || commonProfile.shipping?.firstName,
        familyName: commonProfile.pokemon?.shipping?.familyName || commonProfile.shipping?.lastName,
        streetAddress: commonProfile.pokemon?.shipping?.streetAddress || commonProfile.shipping?.address1,
        extendedAddress: commonProfile.pokemon?.shipping?.extendedAddress || '',
        postalCode: commonProfile.pokemon?.shipping?.postalCode || commonProfile.shipping?.zip,
        phoneNumber: commonProfile.pokemon?.shipping?.phoneNumber || commonProfile.shipping?.phone,
      },
      card: {
        number: commonProfile.pokemon?.card?.number || commonProfile.card?.number,
        cvv: commonProfile.pokemon?.card?.cvv || commonProfile.card?.cvv,
        expMonth: commonProfile.pokemon?.card?.expMonth || commonProfile.card?.expMonth,
        expYear: commonProfile.pokemon?.card?.expYear || commonProfile.card?.expYear,
        nameOnCard: commonProfile.pokemon?.card?.nameOnCard || commonProfile.card?.nameOnCard,
      },
    };
  }

  return baseConfig;
}

// config = { profile: {...}, productUrls: [{url, name, platform}], headless }
ipcMain.handle('start-monitoring', async (event, config) => {
  const started = [];

  for (const product of config.productUrls) {
    if (activeMonitors.has(product.url)) continue;

    const platform = product.platform || 'target';

    sendProductStatus({ url: product.url, status: 'monitoring', platform });

    // Select the appropriate monitor and scraper functions based on platform
    let monitorFn, scraperFn;
    
    if (platform === 'pokemon') {
      monitorFn = monitorPokemonProduct;
      scraperFn = runPokemonScraper;
    } else {
      monitorFn = monitorTargetProduct;
      scraperFn = runTargetScraper;
    }

    // Check if the required functions are available
    if (!monitorFn) {
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: `[${product.name || product.url}] ❌ Monitor function not found for platform: ${platform}. Make sure monitor-${platform}.js exists.`,
        type: 'error'
      });
      sendProductStatus({ url: product.url, status: 'error', platform });
      continue;
    }

    if (!scraperFn) {
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: `[${product.name || product.url}] ❌ Scraper function not found for platform: ${platform}. Make sure scraper-${platform}.js exists.`,
        type: 'error'
      });
      sendProductStatus({ url: product.url, status: 'error', platform });
      continue;
    }

    const handle = await monitorFn(product.url, product.name, {
      onLog: sendLogToRenderer,
      onInStock: async ({ url, name, price }) => {
        activeMonitors.delete(url);
        sendProductStatus({ url, status: 'buying', price, platform });

        // Check if profile exists for this platform
        const hasPlatformProfile = platform === 'pokemon' 
          ? !!(config.profile.pokemon || (config.profile.email && config.profile.password))
          : !!(config.profile.target || (config.profile.email && config.profile.password));

        if (!hasPlatformProfile) {
          sendLogToRenderer({
            timestamp: new Date().toISOString(),
            message: `[${name}] ❌ No ${platform} profile saved — can't checkout. Save your ${platform} profile first.`,
            type: 'error'
          });
          sendProductStatus({ url, status: 'checkout-failed', platform });
          return;
        }

        sendLogToRenderer({
          timestamp: new Date().toISOString(),
          message: `[${name}] 🛒 In stock at ${price} — starting ${platform} checkout...`,
          type: 'info'
        });

        const checkoutConfig = getCheckoutConfig(config.profile, platform, url);

        try {
          const result = await scraperFn(checkoutConfig, (browser) => {
            activeCheckouts.set(url, browser);
          });

          activeCheckouts.delete(url);

          const status = result?.success ? 'purchased' : (result?.stopped ? 'stopped' : 'checkout-failed');
          sendProductStatus({ url, status, platform });
          sendLogToRenderer({
            timestamp: new Date().toISOString(),
            message: result?.success
              ? `[${name}] ✅ ${platform} checkout completed!`
              : `[${name}] ${result?.stopped ? '🛑' : '❌'} ${result?.stopped ? 'Checkout stopped by user.' : `Checkout did not complete: ${result?.error || 'see logs above'}`}`,
            type: result?.success ? 'success' : (result?.stopped ? 'warning' : 'error')
          });
        } catch (error) {
          sendLogToRenderer({
            timestamp: new Date().toISOString(),
            message: `[${name}] ❌ Checkout error: ${error.message}`,
            type: 'error'
          });
          sendProductStatus({ url, status: 'checkout-failed', platform });
        }
      }
    });

    if (handle) {
      activeMonitors.set(product.url, { handle, platform });
      started.push(product.url);
    }
  }

  return { success: true, monitoring: started };
});

// Stop a specific in-progress checkout
ipcMain.handle('stop-checkout', async (event, url) => {
  const browser = activeCheckouts.get(url);
  if (browser) {
    try { await browser.close(); } catch {}
    activeCheckouts.delete(url);
    return { success: true };
  }
  return { success: false, error: 'No active checkout for this URL' };
});

// Stop all monitoring and checkouts
ipcMain.handle('stop-monitoring', async () => {
  for (const [url, { handle }] of activeMonitors) {
    try { handle.stop(); } catch (e) { console.error('Error stopping monitor:', e); }
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