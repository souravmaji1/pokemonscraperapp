const { connect } = require('puppeteer-real-browser');
const { platform } = require('os');

function getChromeExecutablePath() {
  if (platform() === 'darwin') {
    const possiblePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    const fs = require('fs');
    for (const path of possiblePaths) {
      if (fs.existsSync(path)) return path;
    }
    try {
      const { execSync } = require('child_process');
      const chromePath = execSync(
        'mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\'" | head -1 | xargs -I{} echo {}/Contents/MacOS/Google Chrome',
        { encoding: 'utf8' }
      ).trim();
      if (chromePath && fs.existsSync(chromePath)) return chromePath;
    } catch (e) {}
    return undefined;
  }
  return undefined;
}

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

// HUMAN-LIKE MOUSE MOVEMENT HELPER
const humanLikeMouseMove = async (page, startX, startY, endX, endY, options = {}) => {
  const {
    steps = 60,
    jitterAmount = 2,
    overshoot = true
  } = options;

  // Calculate the path with bezier curve points for more natural movement
  const controlPointX = startX + (endX - startX) * 0.3 + (Math.random() - 0.5) * 50;
  const controlPointY = startY + (Math.random() - 0.5) * 20;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    
    // Quadratic bezier curve for natural movement
    const x = Math.pow(1 - t, 2) * startX + 
              2 * (1 - t) * t * controlPointX + 
              Math.pow(t, 2) * endX;
    const y = Math.pow(1 - t, 2) * startY + 
              2 * (1 - t) * t * controlPointY + 
              Math.pow(t, 2) * endY;
    
    // Add realistic jitter (more in middle, less at edges)
    const jitterX = (Math.random() - 0.5) * jitterAmount * (1 - Math.abs(t - 0.5) * 2);
    const jitterY = (Math.random() - 0.5) * jitterAmount * (1 - Math.abs(t - 0.5) * 2);
    
    await page.mouse.move(x + jitterX, y + jitterY);
    
    // Variable delay - slower at beginning and end (human acceleration/deceleration)
    const baseDelay = 8;
    const variance = Math.sin(t * Math.PI) * 12;
    await sleep(baseDelay + variance + Math.random() * 5);
  }

  // Optional overshoot and correction (very human behavior)
  if (overshoot) {
    const overshootX = endX + (Math.random() * 5);
    await page.mouse.move(overshootX, endY);
    await sleep(30 + Math.random() * 20);
    await page.mouse.move(endX, endY);
    await sleep(20);
  }
};

// Wait for product page to fully load
const waitForProductPageLoad = async (page) => {
  const tag = "loader";
  log(tag, 'Waiting for product page to fully render...');
  
  await sleep(5000);
  
  try {
    await page.waitForSelector('.product-title--EFcVZ', { visible: true, timeout: 20000 });
    log(tag, '✓ Product title visible');
  } catch (e) {
    log(tag, 'Waiting more for title...');
    await sleep(5000);
  }
  
  try {
    await page.waitForSelector('.add-to-cart-button--PZmQF', { visible: true, timeout: 15000 });
    log(tag, '✓ Add to Cart button found');
  } catch (e) {
    log(tag, 'Waiting more for button...');
    await sleep(5000);
  }
  
  await sleep(3000);
  return true;
};

// IMPROVED CAPTCHA DETECTION
const checkForCaptcha = async (page) => {
  try {
    // Check multiple captcha selectors
    const captchaSelectors = [
      '#captcha__frame',
      '#ddv1-captcha-container',
      '.captcha__ddv1',
      '#captcha-container',
      '[data-dd-captcha-container]',
      '.captcha',
      '[data-testid="slider"]',
      '.ddv1-slider-handle'
    ];
    
    for (const selector of captchaSelectors) {
      try {
        const captchaEl = await page.$(selector);
        if (captchaEl) {
          const box = await captchaEl.boundingBox();
          if (box && box.width > 0 && box.height > 0) {
            log('captcha', `🔐 Captcha detected! Selector: ${selector}`);
            log('captcha', `Captcha position: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    // Also check for the slider specifically
    try {
      const slider = await page.$('.slider');
      const sliderContainer = await page.$('.sliderContainer');
      if (slider && sliderContainer) {
        const sliderBox = await slider.boundingBox();
        const containerBox = await sliderContainer.boundingBox();
        if (sliderBox && containerBox && sliderBox.width > 0) {
          log('captcha', '🔐 Slider captcha elements found!');
          return true;
        }
      }
    } catch (e) {}
    
    // Check for DataDome iframe
    try {
      const dataDomeFrame = await page.$('iframe[src*="datadome"]');
      if (dataDomeFrame) {
        log('captcha', '🔐 DataDome iframe detected!');
        return true;
      }
    } catch (e) {}
    
    return false;
  } catch (e) {
    log('captcha', `Error checking captcha: ${e.message}`);
    return false;
  }
};

// ADVANCED SLIDER CAPTCHA SOLVER
const solveSliderCaptcha = async (page) => {
  const tag = "captcha";
  log(tag, '🔐 Attempting to solve slider captcha with advanced method...');
  
  await page.screenshot({ path: 'captcha-detected.png' });
  await sleep(3000);
  
  try {
    // First, try clicking the puzzle tab if it exists
    try {
      const puzzleBtn = await page.$('#captcha__puzzle__button');
      if (puzzleBtn) {
        const isExpanded = await page.evaluate(el => el.getAttribute('aria-expanded'), puzzleBtn);
        if (isExpanded !== 'true') {
          await puzzleBtn.click();
          await sleep(2000);
          log(tag, 'Switched to puzzle/slider tab');
        }
      }
    } catch (e) {
      log(tag, 'Puzzle button not found, continuing...');
    }

    // Try different selectors for the slider handle
    const sliderSelectors = [
      '.slider', 
      '[data-testid="slider"]',
      '.ddv1-slider-handle',
      '[role="slider"]',
      '.slider-button'
    ];
    
    let sliderHandle = null;
    for (const selector of sliderSelectors) {
      try {
        sliderHandle = await page.$(selector);
        if (sliderHandle) {
          log(tag, `Found slider with selector: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!sliderHandle) {
      log(tag, '❌ Could not find slider handle', 'error');
      await page.screenshot({ path: 'captcha-no-slider.png' });
      return false;
    }

    // Get accurate dimensions
    const dimensions = await page.evaluate(() => {
      const slider = document.querySelector('.slider') || 
                    document.querySelector('[data-testid="slider"]') ||
                    document.querySelector('.ddv1-slider-handle') ||
                    document.querySelector('[role="slider"]') ||
                    document.querySelector('.slider-button');
                    
      const track = document.querySelector('.sliderContainer') ||
                   slider?.parentElement ||
                   document.querySelector('[class*="slider"][class*="track"]') ||
                   document.querySelector('.slider-track');
      
      if (!slider || !track) return null;

      const sliderRect = slider.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      
      return {
        startX: sliderRect.x + sliderRect.width / 2,
        startY: sliderRect.y + sliderRect.height / 2,
        endX: trackRect.x + trackRect.width - sliderRect.width / 2 - 2,
        endY: sliderRect.y + sliderRect.height / 2,
        totalDistance: (trackRect.x + trackRect.width - sliderRect.width / 2 - 2) - 
                       (sliderRect.x + sliderRect.width / 2),
        sliderWidth: sliderRect.width,
        trackWidth: trackRect.width,
        sliderHeight: sliderRect.height
      };
    });

    if (!dimensions) {
      log(tag, '❌ Could not get slider dimensions', 'error');
      return false;
    }

    log(tag, `Drag distance: ${Math.round(dimensions.totalDistance)}px`);
    log(tag, `Start: (${Math.round(dimensions.startX)}, ${Math.round(dimensions.startY)})`);
    log(tag, `End: (${Math.round(dimensions.endX)}, ${Math.round(dimensions.endY)})`);
    
    // Approach 1: Human-like drag with multiple attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(tag, `Drag attempt ${attempt}/3`);
      
      // Move to slider naturally (approach from random direction)
      const approachX = dimensions.startX - 30 + Math.random() * 20;
      const approachY = dimensions.startY - 10 + Math.random() * 20;
      
      await humanLikeMouseMove(page, 
        approachX, approachY,
        dimensions.startX, dimensions.startY,
        { steps: 30, jitterAmount: 3 }
      );
      
      await sleep(200 + Math.random() * 300);
      
      // Mouse down with slight movement (human imperfection)
      await page.mouse.move(dimensions.startX, dimensions.startY);
      await sleep(50 + Math.random() * 50);
      await page.mouse.down();
      await sleep(150 + Math.random() * 100);
      
      // Perform the drag with realistic behavior
      const dragEndX = dimensions.endX + (Math.random() * 2 - 1);
      await humanLikeMouseMove(page,
        dimensions.startX, dimensions.startY,
        dragEndX, dimensions.endY,
        { 
          steps: 50 + Math.floor(Math.random() * 30),
          jitterAmount: 4,
          overshoot: true
        }
      );
      
      // Slight pause before release (human hesitation)
      await sleep(100 + Math.random() * 100);
      
      // Release with slight upward movement (human tendency to lift)
      await page.mouse.move(dimensions.endX, dimensions.endY - 1);
      await sleep(30);
      await page.mouse.up();
      
      log(tag, 'Slider released');
      
      // Wait for validation
      await sleep(3000);
      
      // Check if captcha is solved
      const captchaStillThere = await checkForCaptcha(page);
      
      if (!captchaStillThere) {
        log(tag, '🎉 Captcha solved successfully!');
        await page.screenshot({ path: 'captcha-solved.png' });
        await sleep(2000);
        return true;
      }
      
      // Check for success indicators
      const successIndicators = await page.evaluate(() => {
        const checks = [
          '.captcha-success',
          '[data-testid="success"]',
          '.slider-success',
          '[class*="success"]',
          '.ddv1-success'
        ];
        return checks.some(selector => {
          const el = document.querySelector(selector);
          return el !== null && el.offsetParent !== null;
        });
      });
      
      if (successIndicators) {
        log(tag, '✓ Success indicators found');
        await sleep(2000);
        return true;
      }
      
      // Check if slider mask shows completion
      const maskComplete = await page.evaluate(() => {
        const mask = document.querySelector('.sliderMask');
        if (mask) {
          const width = mask.style.width || mask.getAttribute('style') || '';
          return width.includes('100%') || parseInt(width) > 250;
        }
        return false;
      });
      
      if (maskComplete) {
        log(tag, '✓ Slider mask shows completion');
        await sleep(3000);
        return true;
      }
      
      log(tag, `Attempt ${attempt} failed, ${attempt < 3 ? 'retrying...' : 'trying alternative approach...'}`);
      
      // If failed, try refreshing the captcha
      if (attempt < 3) {
        try {
          const refreshBtn = await page.$('[aria-label="Refresh"]') || 
                            await page.$('.captcha-refresh') ||
                            await page.$('#captcha__reload__button') ||
                            await page.$('.ddv1-refresh');
          if (refreshBtn) {
            log(tag, 'Refreshing captcha...');
            await refreshBtn.click();
            await sleep(3000);
          }
        } catch (e) {
          log(tag, 'Could not refresh captcha');
        }
      }
    }
    
    // ALTERNATIVE APPROACH: Ultra-slow, very precise drag
    log(tag, 'Attempting ultra-slow drag method...');
    
    // Refresh captcha one more time
    try {
      const refreshBtn = await page.$('[aria-label="Refresh"]') || 
                        await page.$('.captcha-refresh') ||
                        await page.$('#captcha__reload__button') ||
                        await page.$('.ddv1-refresh');
      if (refreshBtn) {
        await refreshBtn.click();
        await sleep(3000);
      }
    } catch (e) {}
    
    // Re-acquire dimensions (they might have changed after refresh)
    const newDims = await page.evaluate(() => {
      const slider = document.querySelector('.slider') || 
                    document.querySelector('[role="slider"]') ||
                    document.querySelector('.ddv1-slider-handle');
      const track = slider?.parentElement || 
                   document.querySelector('.sliderContainer') ||
                   document.querySelector('[class*="slider"][class*="track"]');
      if (!slider || !track) return null;
      
      const sRect = slider.getBoundingClientRect();
      const tRect = track.getBoundingClientRect();
      
      return {
        startX: sRect.x + sRect.width / 2,
        startY: sRect.y + sRect.height / 2,
        endX: tRect.x + tRect.width - sRect.width / 2 - 2,
        endY: sRect.y + sRect.height / 2
      };
    });
    
    if (newDims) {
      log(tag, 'Performing ultra-slow drag...');
      
      // Very slow drag with micro-movements and speed variations
      await page.mouse.move(newDims.startX, newDims.startY);
      await sleep(300 + Math.random() * 200);
      await page.mouse.down();
      await sleep(200 + Math.random() * 100);
      
      const totalSteps = 100;
      for (let i = 1; i <= totalSteps; i++) {
        const progress = i / totalSteps;
        
        // Add variable speed (slow-fast-slow pattern)
        let adjustedProgress;
        if (progress < 0.15) {
          adjustedProgress = progress * 0.7; // Very slow start
        } else if (progress > 0.85) {
          adjustedProgress = 0.85 + (progress - 0.85) * 0.5; // Slow end
        } else {
          adjustedProgress = progress;
        }
        
        const x = newDims.startX + (newDims.endX - newDims.startX) * adjustedProgress;
        const y = newDims.startY + Math.sin(progress * Math.PI * 3) * 2;
        
        await page.mouse.move(x, y);
        
        // Variable delays to simulate human inconsistency
        const baseDelay = 15;
        const randomDelay = Math.random() * 25;
        await sleep(baseDelay + randomDelay);
      }
      
      // Small overshoot and correct
      await page.mouse.move(newDims.endX + 2, newDims.startY);
      await sleep(50);
      await page.mouse.move(newDims.endX, newDims.startY);
      await sleep(100);
      await page.mouse.up();
      
      log(tag, 'Ultra-slow drag completed');
      await sleep(4000);
      
      if (!(await checkForCaptcha(page))) {
        log(tag, '🎉 Ultra-slow drag worked!');
        return true;
      }
    }
    
    // LAST RESORT: Try rapid, forceful drag
    log(tag, 'Attempting rapid drag as last resort...');
    
    try {
      const refreshBtn = await page.$('[aria-label="Refresh"]');
      if (refreshBtn) {
        await refreshBtn.click();
        await sleep(3000);
      }
    } catch (e) {}
    
    const lastDims = await page.evaluate(() => {
      const slider = document.querySelector('.slider') || document.querySelector('[role="slider"]');
      const track = slider?.parentElement;
      if (!slider || !track) return null;
      
      const sRect = slider.getBoundingClientRect();
      const tRect = track.getBoundingClientRect();
      
      return {
        startX: sRect.x + sRect.width / 2,
        startY: sRect.y + sRect.height / 2,
        endX: tRect.x + tRect.width - sRect.width / 2,
        endY: sRect.y + sRect.height / 2
      };
    });
    
    if (lastDims) {
      await page.mouse.move(lastDims.startX, lastDims.startY);
      await sleep(100);
      await page.mouse.down();
      await sleep(50);
      
      // Rapid movement
      await page.mouse.move(lastDims.endX, lastDims.startY, { steps: 5 });
      await sleep(50);
      await page.mouse.up();
      await sleep(4000);
      
      if (!(await checkForCaptcha(page))) {
        log(tag, '🎉 Rapid drag worked!');
        return true;
      }
    }
    
    // If we get here, all attempts failed
    log(tag, '❌ All captcha solving attempts failed', 'error');
    await page.screenshot({ path: 'captcha-failed.png' });
    return false;
    
  } catch (e) {
    log(tag, `Captcha error: ${e.message}`, 'error');
    await page.screenshot({ path: 'captcha-error.png' });
    return false;
  }
};

// Fixed Cybersource microform iframe handling
const fillCardNumberField = async (page, value) => {
  const tag = "payment";
  log(tag, 'Filling card number...');
  
  await page.waitForSelector('#card-number-container iframe', { visible: true, timeout: 15000 });
  await sleep(2000);
  
  const iframeHandle = await page.$('#card-number-container iframe');
  const frame = await iframeHandle.contentFrame();
  
  if (!frame) throw new Error('Could not access card number iframe');
  
  await frame.waitForSelector('input', { visible: true, timeout: 10000 });
  await frame.click('input');
  await sleep(500);
  
  await frame.evaluate(() => {
    const input = document.querySelector('input');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  
  for (const char of value) {
    await frame.type('input', char, { delay: 50 + Math.random() * 50 });
  }
  
  await page.click('#billing-title');
  await sleep(2000);
};

const fillCVVField = async (page, value) => {
  const tag = "payment";
  log(tag, 'Filling CVV...');
  
  await page.waitForSelector('#security-code-container iframe', { visible: true, timeout: 15000 });
  await sleep(2000);
  
  const iframeHandle = await page.$('#security-code-container iframe');
  const frame = await iframeHandle.contentFrame();
  
  if (!frame) throw new Error('Could not access CVV iframe');
  
  await frame.waitForSelector('input', { visible: true, timeout: 10000 });
  await frame.click('input');
  await sleep(500);
  
  await frame.evaluate(() => {
    const input = document.querySelector('input');
    if (input) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  
  for (const char of value) {
    await frame.type('input', char, { delay: 50 + Math.random() * 50 });
  }
  
  await page.click('#billing-title');
  await sleep(2000);
};

async function clickAddToCart(page) {
  const tag = "addToCart";
  
  log(tag, 'Looking for Add to Cart button...');
  
  let addToCartSuccess = false;

  try {
    await page.waitForSelector('.add-to-cart-button--PZmQF', { visible: true, timeout: 10000 });
    
    const isDisabled = await page.$eval('.add-to-cart-button--PZmQF', btn => btn.disabled);
    if (isDisabled) {
      await page.waitForFunction(() => {
        const btn = document.querySelector('.add-to-cart-button--PZmQF');
        return btn && !btn.disabled;
      }, { timeout: 10000 });
    }
    
    await page.click('.add-to-cart-button--PZmQF');
    addToCartSuccess = true;
    log(tag, '✓ Clicked Add to Cart');
  } catch (e) {
    log(tag, `Click failed: ${e.message}`);
  }
  
  if (!addToCartSuccess) {
    addToCartSuccess = await page.evaluate(() => {
      const btn = document.querySelector('.add-to-cart-button--PZmQF');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (addToCartSuccess) log(tag, '✓ Clicked via evaluate');
  }
  
  if (!addToCartSuccess) {
    log(tag, '❌ Failed to add to cart', 'error');
    return false;
  }
  
  await sleep(4000);
  return true;
}

async function handleCartAndCheckout(page, config) {
  const tag = "cart";
  
  // Navigate to cart
  log(tag, 'Navigating to cart...');
  await page.goto('https://www.pokemoncenter.com/cart', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await sleep(5000);
  
  // Check for captcha
  if (await checkForCaptcha(page)) {
    log(tag, '🔐 Captcha on cart page!');
    const solved = await solveSliderCaptcha(page);
    if (!solved) return false;
    await sleep(3000);
  }
  
  try {
    await page.waitForSelector('.order-item--tCjJM', { visible: true, timeout: 10000 });
    log(tag, '✓ Cart has items');
  } catch (e) {
    log(tag, '⚠️ Cart items not visible');
  }
  
  // Click Sign in & Checkout
  log(tag, 'Looking for Sign in & Checkout...');
  
  let clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => 
      b.textContent.replace(/\s+/g, ' ').trim() === 'Sign in & Checkout' && 
      b.offsetParent !== null
    );
    if (btn) { btn.click(); return true; }
    return false;
  });
  
  if (!clicked) {
    clicked = await page.evaluate(() => {
      const btn = document.querySelector('#guest-checkout');
      if (btn && btn.offsetParent !== null) { btn.click(); return true; }
      return false;
    });
    if (clicked) {
      log(tag, '✓ Used Guest Checkout');
      await sleep(5000);
      
      // Check captcha
      if (await checkForCaptcha(page)) {
        log(tag, '🔐 Captcha after Guest Checkout!');
        const solved = await solveSliderCaptcha(page);
        if (!solved) return false;
        await sleep(3000);
      }
      
      return true;
    }
    
    log(tag, 'Navigating directly to checkout...');
    await page.goto('https://www.pokemoncenter.com/checkout', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await sleep(5000);
    
    // Check captcha
    if (await checkForCaptcha(page)) {
      log(tag, '🔐 Captcha on checkout page!');
      const solved = await solveSliderCaptcha(page);
      if (!solved) return false;
      await sleep(3000);
    }
    
    return true;
  }
  
  log(tag, '✓ Clicked Sign in & Checkout');
  await sleep(3000);
  
  // Fill login
  try {
    await page.waitForSelector('#login-email', { visible: true, timeout: 10000 });
    await page.waitForSelector('#login-password', { visible: true, timeout: 5000 });
    
    await page.click('#login-email');
    await sleep(300);
    await page.evaluate(() => { document.querySelector('#login-email').value = ''; });
    await page.type('#login-email', config.email, { delay: 50 + Math.random() * 50 });
    
    await page.click('#login-password');
    await sleep(300);
    await page.evaluate(() => { document.querySelector('#login-password').value = ''; });
    await page.type('#login-password', config.password, { delay: 50 + Math.random() * 50 });
    
    await sleep(1000);
    
    await page.evaluate(() => {
      const btn = document.querySelector('#login-form button[type="submit"]');
      if (btn) btn.click();
    });
    
    log(tag, '✓ Clicked Sign In');
    await sleep(5000);
    try { await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 }); } catch (e) {}
    await sleep(3000);
    
  } catch (e) {
    log(tag, `Login error: ${e.message}`, 'error');
    return false;
  }
  
  // Check captcha after login
  if (await checkForCaptcha(page)) {
    log(tag, '🔐 Captcha after login!');
    const solved = await solveSliderCaptcha(page);
    if (!solved) return false;
    await sleep(3000);
  }
  
  // Click Continue Checkout
  log(tag, 'Clicking Continue Checkout...');
  
  const continueClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    let btn = buttons.find(b => 
      b.textContent.replace(/\s+/g, ' ').trim() === 'Continue Checkout' && 
      b.offsetParent !== null
    );
    if (!btn) btn = document.querySelector('#checkout');
    
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return true;
    }
    return false;
  });
  
  if (continueClicked) {
    log(tag, '✓ Clicked Continue Checkout');
    
    // CRITICAL: Wait a moment then check for captcha
    await sleep(3000);
    
    // CHECK FOR CAPTCHA MULTIPLE TIMES
    log(tag, 'Checking for captcha after Continue Checkout...');
    
    for (let i = 0; i < 3; i++) {
      const captchaFound = await checkForCaptcha(page);
      if (captchaFound) {
        log(tag, `🔐 CAPTCHA DETECTED (attempt ${i + 1})! Solving...`);
        const solved = await solveSliderCaptcha(page);
        if (solved) {
          log(tag, '✓ Captcha solved, continuing...');
          await sleep(5000);
          break;
        } else {
          log(tag, `❌ Captcha solve attempt ${i + 1} failed`);
          if (i < 2) {
            log(tag, 'Retrying...');
            await sleep(3000);
          } else {
            log(tag, '❌ All captcha attempts failed', 'error');
            return false;
          }
        }
      } else {
        log(tag, 'No captcha detected');
        break;
      }
    }
    
    return true;
  }
  
  const currentUrl = await page.url();
  if (currentUrl.includes('/checkout')) {
    log(tag, '✓ Already on checkout page');
    return true;
  }
  
  await page.goto('https://www.pokemoncenter.com/checkout', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await sleep(5000);
  
  // Check captcha
  if (await checkForCaptcha(page)) {
    const solved = await solveSliderCaptcha(page);
    if (!solved) return false;
    await sleep(3000);
  }
  
  return true;
}

async function runPokemonCheckout(page, config) {
  const tag = "checkout";

  try {
    log(tag, `Navigating to: ${config.productUrl}`);
    
    await page.goto(config.productUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    log(tag, 'Page started loading...');
    await waitForProductPageLoad(page);
    log(tag, '✓ Product page loaded');

    if (await checkForCaptcha(page)) {
      const solved = await solveSliderCaptcha(page);
      if (!solved) return false;
    }

    try {
      const cookieBtn = await page.$('#onetrust-accept-btn-handler');
      if (cookieBtn) { await cookieBtn.click(); await sleep(1000); }
    } catch (e) {}

    const addedToCart = await clickAddToCart(page);
    if (!addedToCart) return false;

    const checkoutReady = await handleCartAndCheckout(page, config);
    if (!checkoutReady) return false;

    if (await checkForCaptcha(page)) {
      const solved = await solveSliderCaptcha(page);
      if (!solved) return false;
      await sleep(3000);
    }

    await sleep(3000);
    
    const hasAddressForm = await page.$('#shipping-address-options-new') !== null;
    
    if (hasAddressForm) {
      log(tag, 'Filling shipping...');
      
      try {
        const expandBtn = await page.$('button[aria-controls="shipping-address-options-new"]');
        if (expandBtn) {
          const isExpanded = await page.evaluate(el => el.getAttribute('aria-expanded') === 'true', expandBtn);
          if (!isExpanded) { await expandBtn.click(); await sleep(1500); }
        }
      } catch (e) {}

      const fields = {
        '#shipping-givenName': config.shipping?.firstName || '',
        '#shipping-familyName': config.shipping?.lastName || '',
        '#shipping-streetAddress': config.shipping?.address1 || '',
        '#shipping-postalCode': config.shipping?.zip || '',
        '#shipping-phoneNumber': config.shipping?.phone || '',
      };

      for (const [sel, val] of Object.entries(fields)) {
        if (val && await page.$(sel)) {
          await page.click(sel);
          await sleep(200);
          await setNativeValue(page, sel, val);
          await sleep(200);
        }
      }
      
      if (config.shipping?.city && await page.$('#shipping-city')) {
        await setNativeValue(page, '#shipping-city', config.shipping.city);
      }
      if (config.shipping?.state && await page.$('#shipping-state')) {
        await page.select('#shipping-state', config.shipping.state);
      }

      await sleep(3000);

      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => 
          b.textContent.trim().toUpperCase() === 'CONTINUE' && 
          b.offsetParent !== null && !b.disabled
        );
        if (btn) btn.click();
      });
      
      await sleep(5000);
      
      if (await checkForCaptcha(page)) {
        const solved = await solveSliderCaptcha(page);
        if (!solved) return false;
        await sleep(3000);
      }
    }

    try {
      const modal = await page.$('#address-suggestion-modal');
      if (modal) {
        const btn = await page.$('#address-suggestion-form button[type="submit"]');
        if (btn) { await btn.click(); await sleep(5000); }
      }
    } catch (e) {}

    await sleep(3000);
    
    try {
      await page.waitForSelector('#billing-selector', { visible: true, timeout: 15000 });
      
      await page.select('#billing-selector', 'credit-card');
      await sleep(6000);
      
      try { await fillCardNumberField(page, config.card.number); } 
      catch (e) {
        try {
          const box = await page.$eval('#card-number-container', el => {
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
          });
          await page.mouse.click(box.x, box.y);
          await sleep(1000);
          await page.keyboard.type(config.card.number, { delay: 100 });
        } catch (e2) {}
      }
      
      try { await fillCVVField(page, config.card.cvv); } 
      catch (e) {
        try {
          const box = await page.$eval('#security-code-container', el => {
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
          });
          await page.mouse.click(box.x, box.y);
          await sleep(1000);
          await page.keyboard.type(config.card.cvv, { delay: 100 });
        } catch (e2) {}
      }
      
      await page.select('#expiryMonth', config.card.expMonth);
      await sleep(500);
      await page.select('#expiryYear', config.card.expYear);
      await sleep(1000);
      
      await page.click('#billing-title');
      await sleep(3000);
      
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find(b => 
          b.textContent.trim().toUpperCase() === 'CONTINUE' && 
          b.offsetParent !== null && !b.disabled
        );
        if (btn) btn.click();
      });
      
      await sleep(5000);
      
      if (await checkForCaptcha(page)) {
        const solved = await solveSliderCaptcha(page);
        if (!solved) return false;
        await sleep(3000);
      }
      
    } catch (e) {
      log(tag, `Payment error: ${e.message}`, 'error');
    }

    log(tag, 'Placing order...');
    
    const orderPlaced = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => {
        const text = b.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
        return (text.includes('PLACE ORDER') || text.includes('SUBMIT ORDER')) && 
               b.offsetParent !== null && !b.disabled;
      });
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (orderPlaced) {
      log(tag, '🎉 Order placed!');
      await sleep(5000);
      return true;
    } else {
      log(tag, '⚠️ Place Order button not found');
      await page.screenshot({ path: 'no-order-button.png' });
      return false;
    }

  } catch (err) {
    log(tag, `❌ Error: ${err.message}`, 'error');
    try { await page.screenshot({ path: 'checkout-error.png' }); } catch (e) {}
    return false;
  }
}

async function runPokemonScraper(config, onBrowserReady) {
  let browser = null;
  let page = null;

  try {
    log("main", "Pokemon Center checkout bot starting...");
    log("main", `Product: ${config.productUrl}`);

    const chromePath = getChromeExecutablePath();
    const connectConfig = {
      headless: false,
      turnstile: true,
      fingerprint: true,
      tf: true,
      args: [
       '--no-sandbox',
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
    
    if (chromePath) {
      connectConfig.customConfig = { executablePath: chromePath };
    }

    log("main", "Connecting to browser...");
    const connectionResult = await connect(connectConfig);

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