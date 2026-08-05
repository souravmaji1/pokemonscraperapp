// scraper.js - Updated for direct Place Order flow after login
const { connect } = require('puppeteer-real-browser');
const { platform } = require('os');

function getChromeExecutablePath() {
  if (platform() === 'darwin') {
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

const PAGE_TIMEOUT = 30000;

function log(tag, message, type = 'info') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${tag}] ${message}`);

  if (global.sendLogToRenderer) {
    global.sendLogToRenderer({
      timestamp,
      message: `[${tag}] ${message}`,
      type
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isDead(page) {
  try {
    return !page.browser().isConnected();
  } catch {
    return true;
  }
}

async function waitForLoadersToClear(
  page,
  tag = "loader-wait",
  timeoutMs = 7000,
  pollInterval = 220
) {
  const start = Date.now();
  let everSawLoader = false;

  while (Date.now() - start < timeoutMs) {
    if (isDead(page)) {
      log(tag, "🛑 Browser closed — aborting wait.");
      throw new Error("STOPPED_BY_USER");
    }

    let loaderCount = 0;
    try {
      loaderCount = await page.evaluate(() => {
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (parseFloat(style.opacity) < 0.05) return false;
          return true;
        };

        const selectors = [
          '[class*="skeleton" i]:not([class*="skeleton-none"])',
          '[class*="Skeleton" i]',
          '[class*="shimmer" i]',
          '[class*="Shimmer" i]',
          '[class*="placeholder-loading" i]',
          '[class*="loading-spinner" i]',
          '[class*="Spinner" i][class*="loading" i]',
          '[data-test*="skeleton" i]',
          '[data-test*="loading-indicator" i]',
          '[data-test*="spinner" i]',
          '[aria-busy="true"][class*="load" i]',
          '.styles_LoadingSpinner__',
          '[class*="styles_Skeleton"]',
        ];

        let count = 0;
        for (const sel of selectors) {
          let nodes;
          try {
            nodes = document.querySelectorAll(sel);
          } catch {
            continue;
          }
          for (const el of nodes) {
            if (isVisible(el)) {
              count++;
              break;
            }
          }
        }
        return count;
      });
    } catch {
      if (isDead(page)) {
        log(tag, "🛑 Browser closed — aborting wait.");
        throw new Error("STOPPED_BY_USER");
      }
      loaderCount = 1;
    }

    if (loaderCount === 0) {
      if (everSawLoader) {
        log(tag, "✅ Loader(s) cleared.");
      }
      return true;
    }

    everSawLoader = true;
    if ((Date.now() - start) % 1000 < pollInterval + 50) {
      log(tag, `Loader still visible (${loaderCount}) – waiting…`);
    }
    await sleep(pollInterval);
  }

  log(tag, `⚠️ Timed out after ${timeoutMs}ms still seeing loader(s) — proceeding.`);
  return false;
}

async function waitForSelectorPolling(page, selector, timeoutMs = 8000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDead(page)) throw new Error("STOPPED_BY_USER");
    try {
      const el = await page.$(selector);
      if (el) return el;
    } catch {
      if (isDead(page)) throw new Error("STOPPED_BY_USER");
    }
    await sleep(intervalMs);
  }
  return null;
}

async function waitReadyThenSelector(
  page,
  selector,
  {
    loaderTimeout = 6000,
    selectorTimeout = 8000,
    pollInterval = 300,
    tag = "wait-ready",
  } = {}
) {
  await waitForLoadersToClear(page, tag, loaderTimeout, 200);
  return waitForSelectorPolling(page, selector, selectorTimeout, pollInterval);
}

async function dismissInterstitials(page) {
  const tag = "interstitial";
  try {
    await waitForLoadersToClear(page, tag, 5000);

    const skipped = await page.evaluate(() => {
      const candidates = document.querySelectorAll("button, a");
      for (const el of candidates) {
        const text = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (
          text === "skip" ||
          text === "no thanks" ||
          text === "maybe later" ||
          text === "not now"
        ) {
          el.click();
          return text;
        }
      }
      return null;
    });

    if (skipped) {
      log(tag, `Dismissed interstitial via "${skipped}" button.`);
      await sleep(2000);
      await dismissInterstitials(page);
    } else {
      log(tag, "No interstitial detected.");
    }
  } catch {}
}

async function dismissTargetCircleModal(page) {
  const tag = "circle-modal";
  log(tag, "Checking for Target Circle join modal...");
  await waitForLoadersToClear(page, tag, 8000);
  await sleep(1000);

  try {
    const dismissed = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      const priority = ["don't join", "maybe later", "not now", "skip"];
      for (const p of priority) {
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || "").trim().toLowerCase();
          if (text === p) {
            btn.click();
            return text;
          }
        }
      }
      return null;
    });

    if (dismissed) {
      log(tag, `Dismissed Target Circle modal via "${dismissed}".`);
      await sleep(2000);
    } else {
      log(tag, "No Target Circle modal found.");
    }
  } catch {}
}

async function loginIfNeeded(page, email, password) {
  const tag = "login";

  await waitForLoadersToClear(page, tag, 5000);

  const emailInput = await waitReadyThenSelector(
    page,
    '#username, input[name="username"]',
    { selectorTimeout: 12000, tag }
  );

  if (!emailInput) {
    log(tag, "No login form detected — skipping login step.");
    return true;
  }

  log(tag, "Login form detected. Starting login flow...");

  try {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email, { delay: 80 });
    log(tag, `Typed email: ${email}`);
    await sleep(500);

    const continueBtn =
      (await page.$("#login")) || (await page.$('button[type="submit"]'));

    if (!continueBtn) {
      log(tag, "⚠️  Could not find Continue button.");
      return false;
    }

    log(tag, "Clicking Continue...");
    await continueBtn.click();

    log(tag, "Waiting for page to finish loading before looking for password screen...");
    await waitForLoadersToClear(page, tag, 6000);

    log(tag, "Waiting for password screen...");
    let pwInput = await waitForSelectorPolling(
      page,
      'input[data-test="login-password"], input#password[type="password"], input[name="password"]',
      15000
    );

    if (!pwInput) {
      log(tag, "Password input not found directly — trying method card click...");
      const methodClicked = await page.evaluate(() => {
        const candidates = document.querySelectorAll(
          '[role="button"], button, div[tabindex="0"]'
        );
        for (const el of candidates) {
          const text = (el.innerText || el.textContent || "").toLowerCase();
          if (text.includes("enter your password")) {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (!methodClicked) {
        log(tag, "⚠️  Could not find password method card.");
        return false;
      }

      log(tag, "Clicked method card, waiting for password input...");
      await waitForLoadersToClear(page, tag, 6000);
      pwInput = await waitForSelectorPolling(
        page,
        'input[data-test="login-password"], input#password[type="password"], input[name="password"]',
        12000
      );

      if (!pwInput) {
        log(tag, "⚠️  Password input still not found after method click.");
        return false;
      }
    }

    await sleep(1000);

    const freshPwInput =
      (await page.$('input[data-test="login-password"]')) ||
      (await page.$('input#password[type="password"]')) ||
      (await page.$('input[name="password"]'));

    if (!freshPwInput) {
      log(tag, "⚠️  Password input disappeared before typing.");
      return false;
    }

    await freshPwInput.click({ clickCount: 3 });
    await freshPwInput.type(password, { delay: 80 });
    log(tag, "Typed password.");
    await sleep(500);

    log(tag, "Looking for Sign in with password submit button...");

    let signInBtn = null;

    try {
      signInBtn = await page.evaluateHandle(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || "").trim();
          if (text === "Sign in with password") {
            return btn;
          }
        }
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || "").trim();
          if (text === "Sign in") {
            return btn;
          }
        }
        return null;
      });
    } catch (e) {
      log(tag, `Error finding sign in button: ${e.message}`);
    }

    if (!signInBtn || !signInBtn.asElement()) {
      log(tag, "⚠️  Could not find sign-in submit button.");
      return false;
    }

    log(tag, "Clicking Sign in with password...");
    await signInBtn.asElement().click();
    log(tag, "Sign-in button clicked. Waiting for auth to resolve...");

    await sleep(1000);
    await waitForLoadersToClear(page, tag, 6000);

    const loginStart = Date.now();
    while (Date.now() - loginStart < 30000) {
      await sleep(2000);

      try {
        const currentUrl = page.url();
        if (!currentUrl.includes('/login') && !currentUrl.includes('/account')) {
          log(tag, `✅  Login successful! Now on: ${currentUrl}`);
          await waitForLoadersToClear(page, tag, 6000);
          await dismissInterstitials(page);
          return true;
        }

        const pwStillThere = await page.$(
          'input[data-test="login-password"], input[name="password"], input#password'
        );
        const emailStillThere = await page.$(
          '#username, input[name="username"]'
        );

        if (!pwStillThere && !emailStillThere) {
          log(tag, `✅  Login successful! Now on: ${page.url()}`);
          await waitForLoadersToClear(page, tag, 6000);
          await dismissInterstitials(page);
          return true;
        }

        const errorEl = await page.$('[data-test="auth-error"], [class*="error-message"]');
        if (errorEl) {
          const errText = await page.evaluate(el => (el.innerText || "").trim(), errorEl).catch(() => "");
          if (errText && errText.length > 2 && !errText.includes("Loading")) {
            log(tag, `❌  Auth error: "${errText}"`);
            return false;
          }
        }

        log(tag, "Still waiting for login to complete...");
      } catch {}
    }

    log(tag, "⚠️  Login timed out after 30s.");
    return false;

  } catch (err) {
    log(tag, `❌ Login flow error: ${err.message}`);
    return false;
  }
}

// ─── NEW: Simplified checkout helper ──────────────────────────────────────

async function clickPlaceOrderAndHandleCVV(page, card) {
  const tag = "place-order";

  // Wait for everything to be stable
  await waitForLoadersToClear(page, tag, 8000);
  await sleep(1500);

  // Look for the Place Order button (from the HTML: data-test="placeOrderButton")
  log(tag, "Looking for Place your order button...");

  const placeOrderBtn = await waitReadyThenSelector(
    page,
    '[data-test="placeOrderButton"]:not([disabled]), button:has-text("Place your order")',
    { selectorTimeout: 10000, tag }
  );

  if (!placeOrderBtn) {
    // Check if button exists but is disabled
    const disabledBtn = await page.$('[data-test="placeOrderButton"][disabled]');
    if (disabledBtn) {
      log(tag, "⚠️  Place Order button is disabled. Account may need address/payment setup first.");
      log(tag, "Attempting to navigate through shipping/payment steps...");
      
      // Fall back to the full checkout flow if button is disabled
      const fullFlowResult = await handlePaymentAndPlaceOrderFull(page, card);
      return fullFlowResult;
    }
    
    log(tag, "⚠️  Place Order button not found at all.");
    return false;
  }

  log(tag, "✅  Place Order button found and enabled! Clicking...");

  // Scroll the button into view
  await page.evaluate((btn) => {
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
  }, placeOrderBtn);
  await sleep(500);

  // Click the button
  await placeOrderBtn.click();
  log(tag, "Place Order button clicked.");

  // Wait for any navigation or modal
  await waitForLoadersToClear(page, tag, 6000);
  await sleep(2000);

  log(tag, `After Place Order click - URL: ${page.url()}`);

  // Handle CVV confirmation modal if it appears
  await handleCVVModal(page, card);

  return true;
}

async function handleCVVModal(page, card) {
  const tag = "cvv-modal";
  log(tag, "Checking for CVV confirmation modal...");

  await waitForLoadersToClear(page, tag, 5000);
  await sleep(1500);

  const cvvInput = await waitForSelectorPolling(
    page,
    '#enter-cvv, input[name="cvv"], input[data-test="cvv-input"]',
    8000
  );

  if (cvvInput) {
    log(tag, "CVV confirmation modal detected!");

    await cvvInput.click({ clickCount: 3 });
    await cvvInput.type(card.cvv, { delay: 100 });
    await sleep(500);

    // Look for confirm button
    const confirmBtnSelectors = [
      '[data-test="confirm-button"]',
      'button:has-text("Confirm")',
      'button:has-text("Submit")',
      'button[type="submit"]',
    ];

    let confirmBtn = null;
    for (const sel of confirmBtnSelectors) {
      confirmBtn = await page.$(sel);
      if (confirmBtn) break;
    }

    if (confirmBtn) {
      log(tag, "Clicking Confirm button...");
      await confirmBtn.click();
      await waitForLoadersToClear(page, tag, 5000);
      await sleep(2000);
      log(tag, `After CVV confirmation URL: ${page.url()}`);
      return true;
    } else {
      log(tag, "⚠️  Confirm button not found in CVV modal.");
      return false;
    }
  }

  // Check for order confirmation page
  const confirmationIndicators = [
    '[data-test="orderConfirmation"]',
    '.styles_order-confirmation__',
    'h1:has-text("Order confirmed")',
    'h2:has-text("Thank you")',
    '[data-test="confirmation-number"]',
  ];

  for (const sel of confirmationIndicators) {
    const found = await page.$(sel);
    if (found) {
      log(tag, "🎉  Order confirmation page detected! Order placed successfully!");
      return true;
    }
  }

  log(tag, "No CVV modal detected - order may have been placed directly.");
  return false;
}

// ─── Fallback: Full payment flow if Place Order was disabled ──────────────

async function handlePaymentAndPlaceOrderFull(page, card) {
  const tag = "payment-full";
  log(tag, "Running full payment flow...");

  await waitForLoadersToClear(page, tag, 8000);
  await sleep(1500);

  // Check if payment is already saved
  const savedPayment = await page.$('[data-test="cart-order-notes-wrapper"], [data-test="IconPaymentVisa"]');

  if (savedPayment) {
    log(tag, "✅  Payment already saved - looking for Place Order button...");

    const placeOrderBtn = await waitReadyThenSelector(
      page,
      '[data-test="placeOrderButton"]:not([disabled])',
      { selectorTimeout: 7000, tag }
    );

    if (placeOrderBtn) {
      log(tag, "✅  Place Order button is enabled! Clicking...");
      await placeOrderBtn.click();
      await waitForLoadersToClear(page, tag, 6000);
      await sleep(2000);
      log(tag, `After place order URL: ${page.url()}`);

      await handleCVVModal(page, card);
      return true;
    }
  }

  // Check if payment selection is needed
  const existingPayment = await page.$('[data-test*="payment-card-radio-"]');

  if (existingPayment) {
    log(tag, "Payment card found. Selecting...");

    const isChecked = await page.evaluate(el => el.checked, existingPayment);
    if (!isChecked) {
      await existingPayment.click();
      await sleep(1000);
    }

    const paymentSaveBtn = await waitReadyThenSelector(
      page,
      '[data-test="save_and_continue_button_step_PAYMENT"]',
      { selectorTimeout: 6000, tag }
    );

    if (paymentSaveBtn) {
      log(tag, "Clicking payment Save and continue...");
      await paymentSaveBtn.click();
      await waitForLoadersToClear(page, tag, 7000);
      await sleep(2000);

      const placeOrderBtn = await waitReadyThenSelector(
        page,
        '[data-test="placeOrderButton"]:not([disabled])',
        { selectorTimeout: 15000, tag }
      );

      if (placeOrderBtn) {
        log(tag, "✅  Clicking Place your order...");
        await placeOrderBtn.click();
        await waitForLoadersToClear(page, tag, 6000);
        await sleep(2000);
        await handleCVVModal(page, card);
        return true;
      }
    }
  }

  // Try to add new card
  log(tag, "Looking for add payment button...");

  const addPaymentBtn = await waitReadyThenSelector(
    page,
    '[data-test="add-new-payment-card-button"], [data-test="add-payment-credit-debit-radio"]',
    { selectorTimeout: 6000, tag }
  );

  if (addPaymentBtn) {
    log(tag, "Clicking add payment method...");
    await addPaymentBtn.click();
    await waitForLoadersToClear(page, tag, 5000);
    await sleep(1500);
  }

  const cardFieldFilled = await fillCardInIframeOrDirect(page, card);
  if (!cardFieldFilled) {
    log(tag, "⚠️  Could not fill card details.");
    return false;
  }

  await sleep(1000);

  const paymentSaveBtn = await waitReadyThenSelector(
    page,
    '[data-test="save_and_continue_button_step_PAYMENT"]',
    { selectorTimeout: 6000, tag }
  );

  if (paymentSaveBtn) {
    log(tag, "Clicking payment Save and continue...");
    await paymentSaveBtn.click();
    await waitForLoadersToClear(page, tag, 5000);
    await sleep(2000);

    const placeOrderBtn = await waitReadyThenSelector(
      page,
      '[data-test="placeOrderButton"]:not([disabled])',
      { selectorTimeout: 15000, tag }
    );

    if (placeOrderBtn) {
      log(tag, "✅  Clicking Place your order...");
      await placeOrderBtn.click();
      await waitForLoadersToClear(page, tag, 5000);
      await sleep(2000);
      await handleCVVModal(page, card);
      return true;
    }
  }

  log(tag, "⚠️  Could not complete payment and order placement.");
  return false;
}

async function fillCardInIframeOrDirect(page, card) {
  const tag = "card-fill";

  await waitForLoadersToClear(page, tag, 6000);

  const directCardInput = await page.$(
    'input[name="cardNumber"], input[id*="card-number"], input[data-test*="card-number"], input[autocomplete="cc-number"]'
  );

  if (directCardInput) {
    log(tag, "Filling card details via direct inputs...");
    await directCardInput.click({ clickCount: 3 });
    await directCardInput.type(card.number, { delay: 50 });
    await sleep(500);

    const expInput = await page.$('input[name="expDate"], input[id*="exp"], input[autocomplete="cc-exp"], input[data-test*="expiration"]');
    if (expInput) { await expInput.click({ clickCount: 3 }); await expInput.type(`${card.expMonth}/${card.expYear}`, { delay: 50 }); await sleep(300); }

    const cvvInput = await page.$('input[name="cvv"], input[id*="cvv"], input[autocomplete="cc-csc"], input[data-test*="cvv"]');
    if (cvvInput) { await cvvInput.click({ clickCount: 3 }); await cvvInput.type(card.cvv, { delay: 50 }); await sleep(300); }

    const nameInput = await page.$('input[name="nameOnCard"], input[id*="name-on-card"], input[autocomplete="cc-name"]');
    if (nameInput) { await nameInput.click({ clickCount: 3 }); await nameInput.type(card.nameOnCard, { delay: 50 }); await sleep(300); }

    return true;
  }

  log(tag, "Direct inputs not found — scanning iframes...");
  const frames = page.frames();
  log(tag, `Total frames on page: ${frames.length}`);

  for (const frame of frames) {
    const frameUrl = frame.url();
    log(tag, `  Frame URL: ${frameUrl}`);

    try {
      const iframeCardInput = await frame.$(
        'input[name="cardNumber"], input[id*="number"], input[placeholder*="card"], input[autocomplete="cc-number"]'
      );

      if (iframeCardInput) {
        log(tag, `Found card input in frame: ${frameUrl}`);
        await iframeCardInput.click({ clickCount: 3 });
        await iframeCardInput.type(card.number, { delay: 50 });
        await sleep(500);

        const iframeExp = await frame.$('input[name="expDate"], input[id*="exp"], input[autocomplete="cc-exp"]');
        if (iframeExp) { await iframeExp.click({ clickCount: 3 }); await iframeExp.type(`${card.expMonth}/${card.expYear}`, { delay: 50 }); await sleep(300); }

        const iframeCvv = await frame.$('input[name="cvv"], input[id*="cvv"], input[autocomplete="cc-csc"]');
        if (iframeCvv) { await iframeCvv.click({ clickCount: 3 }); await iframeCvv.type(card.cvv, { delay: 50 }); await sleep(300); }

        const iframeName = await frame.$('input[name="nameOnCard"], input[autocomplete="cc-name"]');
        if (iframeName) { await iframeName.click({ clickCount: 3 }); await iframeName.type(card.nameOnCard, { delay: 50 }); await sleep(300); }

        return true;
      }
    } catch {}
  }

  log(tag, "⚠️  No card input found in page or any iframe.");
  return false;
}

// ─── Main Checkout Flow ───────────────────────────────────────────────────

async function runCheckout(page, config) {
  const tag = "checkout";

  try {
    // ── STEP 1: Go directly to the product page ──────────────────────────
    log(tag, `Navigating to product page: ${config.productUrl}`);
    await page.goto(config.productUrl, {
      waitUntil: "networkidle2",
      timeout: PAGE_TIMEOUT,
    });

    log(tag, "Waiting for product page skeleton/loaders to clear...");
    await waitForLoadersToClear(page, tag, 8000);
    await sleep(1500);

    // ── STEP 2: Handle variant/option selection if present ───────────────
    const variantSelector = '[data-test="swatch"], [data-test="@web/ProductVariant/swatch"]';
    const hasVariants = await page.$(variantSelector);
    if (hasVariants) {
      log(tag, "Variants detected — selecting first available option...");
      await hasVariants.click();
      await waitForLoadersToClear(page, tag, 8000);
      await sleep(1000);
    }

    // ── STEP 3: Add to Cart ──────────────────────────────────────────────
    log(tag, "Waiting for Add to Cart button to appear and be enabled...");
    await waitForLoadersToClear(page, tag, 7000);

    const addToCartSelectors = [
      '[data-test="addToCartButton"]',
      '[data-test="shoppingCartButton"]',
      'button[aria-label*="Add to cart"]',
      'button[aria-label*="add to cart"]',
    ];

    let addToCartBtn = null;
    const btnWaitStart = Date.now();

    while (Date.now() - btnWaitStart < 8000) {
      for (const sel of addToCartSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            const isDisabled = await page.evaluate(
              (b) => b.disabled || b.getAttribute("aria-disabled") === "true",
              btn
            ).catch(() => true);
            if (!isDisabled) {
              addToCartBtn = btn;
              log(tag, `Found enabled Add to Cart button: ${sel}`);
              break;
            } else {
              log(tag, `Button found but disabled (${sel}), waiting...`);
            }
          }
        } catch {}
      }
      if (addToCartBtn) break;
      await sleep(1000);
    }

    if (!addToCartBtn) {
      log(tag, "⚠️  No clickable Add to Cart button found after 8s.");
      return false;
    }

    await page.evaluate((btn) => btn.scrollIntoView({ behavior: "smooth", block: "center" }), addToCartBtn);
    await sleep(1000);

    log(tag, "Clicking Add to Cart...");

    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 8000 }),
        addToCartBtn.click().then(() => sleep(5000)),
      ]);
    } catch {
      log(tag, "No full navigation after add-to-cart click (modal likely appeared).");
    }

    log(tag, `After add-to-cart URL: ${page.url()}`);
    await waitForLoadersToClear(page, tag, 5000);
    await sleep(1500);

    // ── STEP 4: Navigate to cart ─────────────────────────────────────────
    log(tag, "Looking for View Cart link...");

    let wentToCart = false;

    const viewCartSelectors = [
      '[data-test="cartLink"]',
      'a[href="/cart"]',
      'a[href*="/cart"]',
      '[data-test="go-to-cart-button"]',
    ];

    for (const sel of viewCartSelectors) {
      try {
        const el = await waitReadyThenSelector(page, sel, { selectorTimeout: 6000, tag });
        if (el) {
          log(tag, `Clicking cart link: ${sel}`);
          await Promise.race([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: PAGE_TIMEOUT }),
            el.click().then(() => sleep(5000)),
          ]);
          wentToCart = true;
          log(tag, `✅  Cart page loaded. URL: ${page.url()}`);
          break;
        }
      } catch {}
    }

    if (!wentToCart) {
      log(tag, "View cart link not found — navigating directly to /cart...");
      await page.goto("https://www.target.com/cart", {
        waitUntil: "networkidle2",
        timeout: PAGE_TIMEOUT,
      });
      await sleep(1500);
    }

    await waitForLoadersToClear(page, tag, 5000);

    // ── STEP 5: Click checkout button ────────────────────────────────────
    log(tag, "Looking for checkout button on cart page...");
    await sleep(1500);

    const checkoutBtn = await waitReadyThenSelector(
      page,
      '[data-test="checkout-button"], button:has-text("Check out"), a:has-text("Check out")',
      { selectorTimeout: 5000, tag }
    );

    if (checkoutBtn) {
      log(tag, "Clicking checkout button...");
      try {
        await Promise.race([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: PAGE_TIMEOUT }),
          checkoutBtn.click().then(() => sleep(6000)),
        ]);
      } catch {}
      log(tag, `After checkout click URL: ${page.url()}`);
    } else {
      log(tag, "⚠️  checkout-button not found, trying direct navigation...");
      await page.goto("https://www.target.com/checkout", {
        waitUntil: "networkidle2",
        timeout: PAGE_TIMEOUT,
      });
      await sleep(1500);
    }

    await waitForLoadersToClear(page, tag, 8000);

    // ── STEP 6: Handle login ─────────────────────────────────────────────
    const loginSuccess = await loginIfNeeded(page, config.email, config.password);
    if (!loginSuccess) {
      log(tag, "⚠️  Login may have failed, but continuing to check page state...");
    }

    await waitForLoadersToClear(page, tag, 5000);
    await sleep(1500);
    await dismissInterstitials(page);
    await dismissTargetCircleModal(page);

    // ── STEP 7: Handle post-login navigation ─────────────────────────────
    await waitForLoadersToClear(page, tag, 5000);
    await sleep(1500);
    let currentUrl = page.url();
    log(tag, `Current URL after login: ${currentUrl}`);

    // If still on cart, try clicking checkout again
    if (currentUrl.includes("/cart")) {
      log(tag, "Still on cart — clicking checkout again...");
      const checkoutBtn2 = await waitReadyThenSelector(
        page,
        '[data-test="checkout-button"], button:has-text("Check out")',
        { selectorTimeout: 5000, tag }
      );
      if (checkoutBtn2) {
        try {
          await Promise.race([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: PAGE_TIMEOUT }),
            checkoutBtn2.click().then(() => sleep(6000)),
          ]);
        } catch {}
        log(tag, `Navigated to checkout. URL: ${page.url()}`);
      }
    }

    await waitForLoadersToClear(page, tag, 8000);
    await sleep(2000);

  

     // // ── STEP 8: Check if checkout page has everything pre-filled ─────────
    // // Based on the HTML provided, after login the checkout page shows:
    // // - Cart items with total
    // // - Shipping address pre-filled
    // // - Payment method saved
    // // - Place Order button

    // const placeOrderBtn = await page.$('[data-test="placeOrderButton"]');
    // const shippingAddress = await page.$('[data-test="cart-shipping-address"]');
    // const savedPayment = await page.$('[data-test="IconPaymentVisa"]');

    // log(tag, "Checking checkout page state:");
    // log(tag, `  - Place Order button present: ${!!placeOrderBtn}`);
    // log(tag, `  - Shipping address present: ${!!shippingAddress}`);
    // log(tag, `  - Payment method present: ${!!savedPayment}`);

    // // ── STEP 9: Click Place Order and handle CVV ─────────────────────────
    // if (placeOrderBtn || shippingAddress || savedPayment) {
    //   // Everything looks pre-filled - just click Place Order
    //   log(tag, "✅  Checkout page has all required fields. Clicking Place Order directly...");
    //   const orderPlaced = await clickPlaceOrderAndHandleCVV(page, config.card);
    //   
    //   if (orderPlaced) {
    //     log(tag, "🎉  Order process completed!");
    //     log(tag, `Final URL: ${page.url()}`);
    //     return true;
    //   }
    // }

    // // If direct Place Order didn't work, fall back to full flow
    // log(tag, "Direct Place Order approach failed. Falling back to full checkout flow...");
    // const orderPlaced = await handlePaymentAndPlaceOrderFull(page, config.card);
    // 
    // if (orderPlaced) {
    //   log(tag, "🎉  Order process completed via full flow!");
    //   log(tag, `Final URL: ${page.url()}`);
    //   return true;
    // }

    // log(tag, "⚠️  Could not place order through any method.");
    // log(tag, `Current URL: ${page.url()}`);
    // return false;

    // ── STEP 8: Click Place Order directly ─────────────────────────────
    log(tag, "Clicking Place Order directly without checking pre-filled fields...");
    const orderPlaced = await clickPlaceOrderAndHandleCVV(page, config.card);
    
    if (orderPlaced) {
      log(tag, "🎉  Order process completed!");
      log(tag, `Final URL: ${page.url()}`);
      return true;
    }

    log(tag, "⚠️  Could not place order.");
    log(tag, `Current URL: ${page.url()}`);
    return false;

  } catch (err) {
    log(tag, `❌ Checkout flow failed: ${err.message}`);
    return false;
  }
}

async function runScraper(config, onBrowserReady) {
  let browser = null;
  let page = null;

  try {
    log("main", "Target checkout bot starting with puppeteer-real-browser.");
    log("main", `Product: ${config.productUrl}`);

    const headless = false;
    log("main", `Mode: ${headless ? 'Headless' : 'Visible'}`);

    const chromePath = getChromeExecutablePath();

    const connectConfig = {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--start-minimized',
    //    '--window-position=9999,9999',
     //   '--window-size=800,600',
     //  '--suppress-message-center-popups',
     //   '--disable-notifications',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };
    if (chromePath) {
      connectConfig.customConfig = { executablePath: chromePath };
    }

    const connectionResult = await connect(connectConfig);

    browser = connectionResult.browser;
    page = connectionResult.page;

    if (onBrowserReady) onBrowserReady(browser);

    log("main", "Connected to real browser instance.");

    if (!headless) {
      await page.setViewport({ width: 1920, height: 1080 });
    }

    const success = await runCheckout(page, config);

    if (success) {
      log("main", "🎉  Checkout completed successfully!");
    } else {
      log("main", "❌  Checkout did not complete. Check logs above.");
    }

    if (headless) {
      await browser.close();
      log("main", "Browser closed.");
    } else {
      log("main", "Browser kept open for inspection.");
    }

    return { success };

  } catch (err) {
    const stopped = err.message && (err.message.includes('closed') || err.message.includes('detached') || err.message.includes('Protocol error'));
    log("main", stopped ? "Checkout stopped by user." : `Fatal error: ${err.message}`, stopped ? "warning" : "error");

    if (browser && config.headless) {
      try { await browser.close(); } catch {}
    }

    return { success: false, error: stopped ? 'Stopped by user' : err.message, stopped };
  }
}

module.exports = { runScraper };