const { connect } = require('puppeteer-real-browser');
const { platform } = require('os');

// Detect correct Chrome path based on OS
function getChromeExecutablePath() {
  if (platform() === 'darwin') {
    // macOS: Try common Chrome/Chromium paths
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
    ];
    
    const fs = require('fs');
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        return path;
      }
    }
    
    // Fallback: try to find via command
    try {
      const { execSync } = require('child_process');
      const chromePath = execSync(
        'mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\'" | head -1 | xargs -I{} echo {}/Contents/MacOS/Google Chrome',
        { encoding: 'utf8' }
      ).trim();
      if (chromePath && fs.existsSync(chromePath)) {
        return chromePath;
      }
    } catch (e) {
      // ignore
    }
    
    console.warn('⚠️ Could not find Chrome on macOS. Install Google Chrome or set PUPPETEER_EXECUTABLE_PATH env variable.');
    return undefined;
  }
  // Windows/Linux: let puppeteer-real-browser auto-detect
  return undefined;
}

async function monitorTargetProduct(url, name, { onLog, onInStock, checkIntervalMin = 10000, checkIntervalMax = 19000 } = {}) {
  const log = (message, type = 'info') => {
    if (onLog) {
      onLog({ timestamp: new Date().toISOString(), message: `[${name}] ${message}`, type });
    }
  };

  let browser;
  let stopped = false;

  try {
    log('Starting monitor browser...');

    const chromePath = getChromeExecutablePath();
    const connectConfig = {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--start-minimized',
        '--window-position=9999,9999',
        '--window-size=800,600',
        '--suppress-message-center-popups',
        '--disable-notifications',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    // On macOS, explicitly set the Chrome executable path
    if (chromePath) {
      connectConfig.customConfig = { executablePath: chromePath };
      log(`Using Chrome at: ${chromePath}`);
    }

    const { browser: realBrowser, page } = await connect(connectConfig);

    browser = realBrowser;
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    );

    let checkCount = 0;

    // Run the polling loop in the background so monitorProduct can return a handle immediately
    (async () => {
      while (!stopped) {
        checkCount++;
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

          await page.waitForFunction(() => {
            const loadingText = document.body.innerText.includes('Still loading...') ||
              document.querySelector('.styles_ndsSpinner__agM2w');
            return !loadingText;
          }, { timeout: 20000 }).catch(() => log('Loader timeout, checking anyway...'));

          await page.evaluate(() => new Promise(r => setTimeout(r, 2500)));

          const status = await page.evaluate(() => {
            const bodyText = document.body.innerText.toLowerCase();
            const stockElement = document.querySelector('[data-test="variationAvailabilitySneakPeek"]');
            const stockText = stockElement ? stockElement.innerText.toLowerCase() : '';
            const hasInStock = stockText.includes('in stock') || bodyText.includes('in stock') ||
              (!bodyText.includes('out of stock') && !bodyText.includes('sold out'));
            const addToCartBtn = document.querySelector(
              'button[id*="addToCart"], button[data-test="add-to-cart"], button[aria-label*="Add to cart"]'
            );
            let buttonEnabled = false;
            let buttonText = 'No button found';
            if (addToCartBtn) {
              buttonText = addToCartBtn.innerText.trim();
              buttonEnabled = !addToCartBtn.disabled && !addToCartBtn.hasAttribute('disabled') &&
                !buttonText.toLowerCase().match(/sold out|out of stock|unavailable/);
            }
            const priceEl = document.querySelector('[data-test="product-price"]');
            const price = priceEl ? priceEl.innerText.trim() : 'N/A';
            return { inStock: hasInStock && buttonEnabled, buttonText, price };
          });

          if (status.inStock) {
            log(`✅ IN STOCK! Price: ${status.price} | Button: ${status.buttonText}`, 'success');
            stopped = true;
            if (onInStock) await onInStock({ url, name, price: status.price });
            break;
          } else {
            log(`#${checkCount} → Unavailable | Button: ${status.buttonText}`);
          }
        } catch (err) {
          log(`Error checking stock: ${err.message}`, 'error');
        }

        if (stopped) break;
        const delay = checkIntervalMin + Math.random() * (checkIntervalMax - checkIntervalMin);
        await new Promise(r => setTimeout(r, delay));
      }

      try { await browser.close(); } catch {}
    })();

    return {
      stop: () => { stopped = true; },
    };
  } catch (e) {
    log(`Failed to start monitor browser: ${e.message}`, 'error');
    return { stop: () => { stopped = true; } };
  }
}

module.exports = { monitorTargetProduct };