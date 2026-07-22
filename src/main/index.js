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
const activeTwitterMonitors = new Map(); // 'twitter-monitor' -> { stop, profileHandles }

// Try to require the modules - they might be in different locations
let monitorTargetProduct, monitorPokemonProduct, runTargetScraper, runPokemonScraper, monitorTwitterProfiles;

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

try {
  const twitterMonitor = require('../../monitor-twitter');
  monitorTwitterProfiles = twitterMonitor.monitorTwitterProfiles;
} catch (e) {
  console.error('Failed to load monitor-twitter:', e.message);
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
    try { 
      mainWindow.webContents.send('scraper-log', logData); 
    } catch (error) {
      console.error('Failed to send log to renderer:', error);
    }
  }
}

function sendProductStatus(data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { 
      mainWindow.webContents.send('product-status', data); 
    } catch (error) {
      console.error('Failed to send product status to renderer:', error);
    }
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

// Helper function to start product monitoring from URL
async function startProductMonitoring(url, platform, userProfile, source = 'manual') {
  if (activeMonitors.has(url)) {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: `[${source}] URL already being monitored: ${url}`,
      type: 'info'
    });
    return false;
  }

  sendProductStatus({ url, status: 'monitoring', platform, source });

  const monitorFn = platform === 'pokemon' ? monitorPokemonProduct : monitorTargetProduct;
  const scraperFn = platform === 'pokemon' ? runPokemonScraper : runTargetScraper;

  if (!monitorFn) {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: `[${source}] ❌ Monitor function not found for platform: ${platform}`,
      type: 'error'
    });
    sendProductStatus({ url, status: 'error', platform });
    return false;
  }

  if (!scraperFn) {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: `[${source}] ❌ Scraper function not found for platform: ${platform}`,
      type: 'error'
    });
    sendProductStatus({ url, status: 'error', platform });
    return false;
  }

  const productName = url.split('/').pop() || url;
  
  const handle = await monitorFn(url, productName, {
    onLog: sendLogToRenderer,
    onInStock: async ({ url, name, price }) => {
      activeMonitors.delete(url);
      sendProductStatus({ url, status: 'buying', price, platform });

      const hasPlatformProfile = platform === 'pokemon' 
        ? !!(userProfile.pokemon?.email || (userProfile.email && userProfile.password))
        : !!(userProfile.target?.email || (userProfile.email && userProfile.password));

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

      const checkoutConfig = getCheckoutConfig(userProfile, platform, url);

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
    activeMonitors.set(url, { handle, platform });
    return true;
  }
  return false;
}

// config = { profile: {...}, productUrls: [{url, name, platform}], headless }
ipcMain.handle('start-monitoring', async (event, config) => {
  const started = [];

  for (const product of config.productUrls) {
    if (activeMonitors.has(product.url)) continue;

    const platform = product.platform || 'target';
    const success = await startProductMonitoring(product.url, platform, config.profile, 'manual');
    
    if (success) {
      started.push(product.url);
    }
  }

  return { success: true, monitoring: started };
});

// Twitter Monitor
ipcMain.handle('start-twitter-monitor', async (event, config) => {
  const { twitterProfiles, profile: userProfile } = config;
  
  if (!twitterProfiles || twitterProfiles.length === 0) {
    return { success: false, error: 'No Twitter profiles configured' };
  }

  if (!monitorTwitterProfiles) {
    sendLogToRenderer({
      timestamp: new Date().toISOString(),
      message: '❌ Twitter monitor module not found. Make sure monitor-twitter.js exists.',
      type: 'error'
    });
    return { success: false, error: 'Module not found' };
  }

  // Check if already monitoring
  const existingMonitor = activeTwitterMonitors.get('twitter-monitor');
  if (existingMonitor) {
    return { success: false, error: 'Twitter monitor already running' };
  }

  sendLogToRenderer({
    timestamp: new Date().toISOString(),
    message: `🐦 Starting Twitter monitor for ${twitterProfiles.length} profile(s)`,
    type: 'info'
  });

  const handle = await monitorTwitterProfiles(twitterProfiles, {
    onLog: sendLogToRenderer,
    onUrlsFound: async ({ url, platform, source, tweetText }) => {
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: `[${source}] 🔗 New product URL found: ${url} (${platform})`,
        type: 'success'
      });

      await startProductMonitoring(url, platform, userProfile, source);
    }
  });

  activeTwitterMonitors.set('twitter-monitor', handle);
  return { success: true };
});

ipcMain.handle('stop-twitter-monitor', async () => {
  const monitor = activeTwitterMonitors.get('twitter-monitor');
  if (monitor) {
    try { 
      monitor.stop(); 
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: '🛑 Twitter monitor stopped',
        type: 'info'
      });
    } catch (e) {
      console.error('Error stopping Twitter monitor:', e);
    }
    activeTwitterMonitors.delete('twitter-monitor');
    return { success: true };
  }
  return { success: false, error: 'No active Twitter monitor' };
});

// Stop a specific in-progress checkout
ipcMain.handle('stop-checkout', async (event, url) => {
  const browser = activeCheckouts.get(url);
  if (browser) {
    try { await browser.close(); } catch (e) {
      console.error('Error closing browser:', e);
    }
    activeCheckouts.delete(url);
    return { success: true };
  }
  return { success: false, error: 'No active checkout for this URL' };
});

// Stop all monitoring and checkouts
ipcMain.handle('stop-monitoring', async () => {
  // Stop Twitter monitor
  const twitterMonitor = activeTwitterMonitors.get('twitter-monitor');
  if (twitterMonitor) {
    try { 
      twitterMonitor.stop(); 
      sendLogToRenderer({
        timestamp: new Date().toISOString(),
        message: '🛑 Twitter monitor stopped',
        type: 'info'
      });
    } catch (e) {
      console.error('Error stopping Twitter monitor:', e);
    }
    activeTwitterMonitors.delete('twitter-monitor');
  }

  // Stop product monitors
  for (const [url, { handle }] of activeMonitors) {
    try { 
      handle.stop(); 
    } catch (e) { 
      console.error('Error stopping monitor:', e); 
    }
    sendProductStatus({ url, status: 'stopped' });
  }
  activeMonitors.clear();

  // Stop active checkouts
  for (const [url, browser] of activeCheckouts) {
    try { 
      await browser.close(); 
    } catch (e) {
      console.error('Error closing checkout browser:', e);
    }
    sendProductStatus({ url, status: 'stopped' });
  }
  activeCheckouts.clear();

  return { success: true };
});

// Get current status
ipcMain.handle('get-status', async () => {
  return {
    isMonitoring: activeMonitors.size > 0,
    isTwitterMonitoring: activeTwitterMonitors.has('twitter-monitor'),
    activeCheckouts: activeCheckouts.size,
    monitoredUrls: Array.from(activeMonitors.keys()),
    twitterProfiles: activeTwitterMonitors.get('twitter-monitor')?.profileHandles || []
  };
});