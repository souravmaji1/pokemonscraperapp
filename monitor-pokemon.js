const { connect } = require('puppeteer-real-browser');

async function monitorPokemonProduct(url, name, { onLog, onInStock, checkIntervalMin = 15000, checkIntervalMax = 25000 } = {}) {
  const log = (message, type = 'info') => {
    if (onLog) {
      onLog({ timestamp: new Date().toISOString(), message: `[Pokemon][${name}] ${message}`, type });
    }
  };

  let browser;
  let stopped = false;

  try {
    log('Starting Pokemon Center monitor browser...');

    const { browser: realBrowser, page } = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      tf: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--start-minimized',
        '--window-position=9999,9999',
        '--window-size=800,600',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    browser = realBrowser;
    await page.setViewport({ width: 1366, height: 900 });

    let checkCount = 0;

    (async () => {
      while (!stopped) {
        checkCount++;
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

          // Wait for add to cart button to render
          await page.waitForSelector('button[class*="add-to-cart-button"]', { 
            timeout: 15000 
          }).catch(() => null);

          const status = await page.evaluate(() => {
            const btn = document.querySelector('button[class*="add-to-cart-button"]');
            if (!btn) return { found: false, inStock: false };

            const isDisabled = btn.disabled === true || btn.hasAttribute('disabled');
            const text = btn.textContent.trim();
            const inStock = !isDisabled && /add to cart/i.test(text);

            // Get price
            const priceEl = document.querySelector('[class*="product-price"], .price, [data-testid="price"]');
            const price = priceEl ? priceEl.textContent.trim() : 'N/A';

            return { found: true, inStock, text, price };
          });

          if (status.inStock) {
            log(`✅ IN STOCK! Price: ${status.price} | Button: ${status.text}`, 'success');
            stopped = true;
            if (onInStock) await onInStock({ url, name, price: status.price });
            break;
          } else {
            log(`#${checkCount} → Unavailable | Button: ${status.text || 'Not found'}`);
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
    log(`Failed to start Pokemon monitor browser: ${e.message}`, 'error');
    return { stop: () => { stopped = true; } };
  }
}

module.exports = { monitorPokemonProduct };