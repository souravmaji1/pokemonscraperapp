const { connect } = require('puppeteer-real-browser');

function log(tag, message, type = 'info') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [Pokemon][${tag}] ${message}`);

  if (global.sendLogToRenderer) {
    global.sendLogToRenderer({
      timestamp,
      message: `[Pokemon][${tag}] ${message}`,
      type
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// React-controlled inputs helper
const setNativeValue = async (page, selector, value) => {
  await page.evaluate((sel, val) => {
    const input = document.querySelector(sel);
    if (!input) return false;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, selector, value);
};

const waitForPageLoad = async (page, timeout = 15000) => {
  try {
    await page.waitForNetworkIdle({ idleTime: 2000, timeout });
  } catch (e) {
    log('loader', 'Network idle timeout, continuing...');
  }
  await page.waitForFunction(() => document.readyState === 'complete', { timeout });
  await sleep(3000);
};

const fillMicroformField = async (page, containerSelector, value, fieldName) => {
  log('payment', `Filling ${fieldName}: "${value}"`);
  
  const iframeSelector = `${containerSelector} iframe`;
  await page.waitForSelector(iframeSelector, { visible: true, timeout: 20000 });
  
  const iframeElement = await page.$(iframeSelector);
  const box = await iframeElement.boundingBox();
  
  if (!box) {
    throw new Error(`Could not get bounding box for ${fieldName} iframe`);
  }
  
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(1000);
  
  await page.keyboard.type(value, { delay: 100 });
  log('payment', `Typed ${value.length} characters for ${fieldName}`);
  
  await page.click('#billing-title');
  await sleep(1500);
};

async function runPokemonCheckout(page, config) {
  const tag = "checkout";

  try {
    // Navigate to product page
    log(tag, `Navigating to product: ${config.productUrl}`);
    await page.goto(config.productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForPageLoad(page);
    await sleep(2000);

    // Close any overlays
    const overlaySelectors = [
      '#modalclose button',
      '[aria-label="close"]',
      '.modal-close--maHgB button',
      'button:has(svg[data-icon="xmark"])',
      '#onetrust-accept-btn-handler',
      '.close-button',
      '[data-testid="close-button"]',
      '.cookie-banner button',
      '.promo-modal .close'
    ];
    
    for (const sel of overlaySelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          log(tag, `Closing overlay: ${sel}`);
          await el.click();
          await sleep(1000);
        }
      } catch (e) {
        continue;
      }
    }

    // Add to cart
    log(tag, 'Clicking Add to Cart...');
    
    let addToCartSuccess = false;
    
    try {
      await page.waitForSelector('.add-to-cart-button--PZmQF', { visible: true, timeout: 10000 });
      await page.click('.add-to-cart-button--PZmQF');
      addToCartSuccess = true;
    } catch (e) {
      log(tag, 'Strategy 1 failed, trying text match...');
      
      addToCartSuccess = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const addBtn = buttons.find(btn => 
          btn.textContent.trim().toUpperCase() === 'ADD TO CART' && 
          btn.offsetParent !== null
        );
        if (addBtn) {
          addBtn.click();
          return true;
        }
        return false;
      });
    }

    if (!addToCartSuccess) {
      log(tag, '❌ Failed to add to cart');
      return false;
    }

    await sleep(3000);
    log(tag, 'Added to cart successfully');

    // Open cart
    log(tag, 'Opening cart...');
    await page.waitForSelector('.header-cart--_2R2kd', { visible: true, timeout: 15000 });
    await page.click('.header-cart--_2R2kd');
    await sleep(2000);
    await waitForPageLoad(page);

    // Click checkout
    log(tag, 'Clicking checkout...');
    const checkoutClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const checkoutBtn = buttons.find(b => 
        (b.textContent.trim().toUpperCase().includes('CHECKOUT') ||
         b.textContent.trim().toUpperCase().includes('CONTINUE')) && 
        b.offsetParent !== null
      );
      if (checkoutBtn) {
        checkoutBtn.click();
        return true;
      }
      return false;
    });

    if (!checkoutClicked) {
      log(tag, 'Navigating directly to checkout...');
      await page.goto('https://www.pokemoncenter.com/checkout', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    }

    await waitForPageLoad(page);
    await sleep(3000);

    // Handle shipping if needed
    const hasAddressForm = await page.$('#shipping-address-options-new') !== null;
    
    if (hasAddressForm) {
      log(tag, 'Filling shipping address...');
      
      const isExpanded = await page.$eval(
        'button[aria-controls="shipping-address-options-new"]',
        el => el.getAttribute('aria-expanded') === 'true'
      ).catch(() => false);
      
      if (!isExpanded) {
        await page.click('button[aria-controls="shipping-address-options-new"]');
        await sleep(1000);
      }

      const shippingFields = [
        { selector: '#shipping-givenName', value: config.shipping?.firstName || config.shipping?.givenName || '' },
        { selector: '#shipping-familyName', value: config.shipping?.lastName || config.shipping?.familyName || '' },
        { selector: '#shipping-streetAddress', value: config.shipping?.address1 || config.shipping?.streetAddress || '' },
        { selector: '#shipping-postalCode', value: config.shipping?.zip || config.shipping?.postalCode || '' },
        { selector: '#shipping-phoneNumber', value: config.shipping?.phone || config.shipping?.phoneNumber || '' },
      ];

      for (const field of shippingFields) {
        if (field.value && await page.$(field.selector)) {
          await page.click(field.selector);
          await sleep(300);
          await setNativeValue(page, field.selector, field.value);
          await sleep(300);
        }
      }

      await sleep(2000); // Wait for city/state auto-population

      // Click Continue
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const continueBtn = buttons.find(b => 
          b.textContent.trim().toUpperCase() === 'CONTINUE' && 
          b.offsetParent !== null
        );
        if (continueBtn) continueBtn.click();
      });

      await waitForPageLoad(page);
      await sleep(2000);
    }

    // Handle address suggestion modal
    const hasModal = await page.$('#address-suggestion-modal') !== null;
    if (hasModal) {
      log(tag, 'Accepting suggested address...');
      const submitBtn = await page.$('#address-suggestion-form button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
        await waitForPageLoad(page);
        await sleep(2000);
      }
    }

    // Payment section
    log(tag, 'Handling payment...');
    await page.waitForSelector('#billing-selector', { visible: true, timeout: 20000 });
    await sleep(1500);

    // Select Credit/Debit Card
    await page.select('#billing-selector', 'credit-card');
    await sleep(6000); // Wait for iframes

    // Fill card details
    await fillMicroformField(page, '#card-number-container', config.card.number, 'Card Number');
    await fillMicroformField(page, '#security-code-container', config.card.cvv, 'CVV');

    // Set expiry
    await page.select('#expiryMonth', config.card.expMonth);
    await sleep(600);
    await page.select('#expiryYear', config.card.expYear);
    await sleep(800);

    // Trigger validation
    await page.click('#billing-title');
    await sleep(3000);

    // Click Continue
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const continueBtn = buttons.find(b => 
        b.textContent.trim().toUpperCase() === 'CONTINUE' && 
        b.offsetParent !== null &&
        !b.disabled
      );
      if (continueBtn) continueBtn.click();
    });

    await sleep(5000);

    // Place Order
    log(tag, 'Placing order...');
    const orderPlaced = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const placeOrderBtn = buttons.find(b => 
        b.textContent.trim().toUpperCase().includes('PLACE ORDER') && 
        b.offsetParent !== null
      );
      if (placeOrderBtn) {
        placeOrderBtn.click();
        return true;
      }
      return false;
    });

    if (orderPlaced) {
      log(tag, '🎉 Order placed successfully!');
      await sleep(5000);
      return true;
    } else {
      log(tag, '⚠️ Place Order button not found');
      return false;
    }

  } catch (err) {
    log(tag, `❌ Checkout failed: ${err.message}`, 'error');
    return false;
  }
}

async function runPokemonScraper(config, onBrowserReady) {
  let browser = null;
  let page = null;

  try {
    log("main", "Pokemon Center checkout bot starting...");
    log("main", `Product: ${config.productUrl}`);

    const connectionResult = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      tf: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--start-minimized',
        '--window-position=9999,9999',
        '--window-size=800,600',
        '--suppress-message-center-popups',
        '--disable-notifications',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    browser = connectionResult.browser;
    page = connectionResult.page;

    if (onBrowserReady) onBrowserReady(browser);

    log("main", "Connected to real browser instance.");
    await page.setViewport({ width: 1366, height: 900 });

    const success = await runPokemonCheckout(page, config);

    if (success) {
      log("main", "🎉 Checkout completed successfully!");
    } else {
      log("main", "❌ Checkout did not complete.");
    }

    return { success };

  } catch (err) {
    const stopped = err.message && (
      err.message.includes('closed') || 
      err.message.includes('detached') || 
      err.message.includes('Protocol error')
    );
    log("main", stopped ? "Checkout stopped by user." : `Fatal error: ${err.message}`, stopped ? "warning" : "error");

    if (browser) {
      try { await browser.close(); } catch {}
    }

    return { success: false, error: stopped ? 'Stopped by user' : err.message, stopped };
  }
}

module.exports = { runPokemonScraper };