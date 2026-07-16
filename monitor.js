const { connect } = require('puppeteer-real-browser');

async function monitorProduct(url, name, { onLog, onInStock, checkIntervalMin = 10000, checkIntervalMax = 19000 } = {}) {
  const log = (message, type = 'info') => {
    if (onLog) {
      onLog({ timestamp: new Date().toISOString(), message: `[${name}] ${message}`, type });
    }
  };

  let browser;
  let stopped = false;

  try {
    log('Starting monitor browser...');

    const { browser: realBrowser, page } = await connect({
      headless: true,           // Real browser (headful)
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-infobars',              // Old flag for automation bar
    '--disable-blink-features=AutomationControlled',
    '--start-minimized',               // Try to start minimized
    '--window-position=9999,9999',
    '--window-size=800,600',           // Small window
    '--suppress-message-center-popups',
    '--disable-notifications',
  ],
  ignoreDefaultArgs: ['--enable-automation'],
    });

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

module.exports = { monitorProduct };