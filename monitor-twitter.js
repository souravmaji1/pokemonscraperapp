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
    
    console.warn('⚠️ Could not find Chrome on macOS.');
    return undefined;
  }
  return undefined;
}

const ALLOWED_DOMAINS = ['pokemoncenter.com', 'target.com'];

function isAllowedUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

function extractUrlsFromTweet(text, linkElements) {
  const urls = [];
  
  // Extract from link elements
  for (const link of linkElements) {
    const href = link.getAttribute('href');
    if (!href) continue;

    const isInternal = 
      href.startsWith('/status/') ||
      href.startsWith('/hashtag/') ||
      href.startsWith('/search') ||
      href.startsWith('/i/') ||
      href === '/';

    if (!isInternal) {
      if (href.startsWith('http')) {
        urls.push(href);
      } else if (href.startsWith('/')) {
        urls.push('https://x.com' + href);
      }
    }
  }

  // Also extract from text using regex
  const urlRegex = /https?:\/\/[^\s]+/g;
  const textUrls = text.match(urlRegex) || [];
  
  // Expand t.co URLs from text
  for (const url of textUrls) {
    if (!url.includes('t.co') && !urls.includes(url)) {
      urls.push(url);
    }
  }

  return [...new Set(urls)];
}

async function scrollAndCollectTweets(page, profile, { onLog, maxScrolls = 15 }) {
  const log = (msg, type = 'info') => {
    if (onLog) onLog({ timestamp: new Date().toISOString(), message: `[Twitter][${profile}] ${msg}`, type });
  };

  let tweets = [];
  let lastTweetCount = 0;
  let noNewTweetsCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    const currentTweets = await page.evaluate((handle) => {
      const articles = Array.from(document.querySelectorAll('article[data-tweet-id]'));
      return articles.map(article => {
        const tweetId = article.getAttribute('data-tweet-id');
        const textEl = article.querySelector('div[dir="auto"]');
        const text = textEl ? textEl.innerText.trim() : '';
        const linkEls = Array.from(article.querySelectorAll('a[href]'));
        return { tweetId, text, linkElements: linkEls.map(l => l.getAttribute('href')) };
      });
    }, profile);

    // Check if we're getting new tweets
    if (currentTweets.length === lastTweetCount) {
      noNewTweetsCount++;
      if (noNewTweetsCount >= 3) {
        log(`No new tweets after ${i + 1} scrolls, stopping scroll`);
        break;
      }
    } else {
      noNewTweetsCount = 0;
    }
    lastTweetCount = currentTweets.length;

    // Process current tweets
    for (const tweet of currentTweets) {
      if (!tweets.find(t => t.tweetId === tweet.tweetId)) {
        const urls = extractUrlsFromTweet(tweet.text, []);
        const allowedUrls = urls.filter(isAllowedUrl);
        
        if (allowedUrls.length > 0) {
          tweets.push({
            tweetId: tweet.tweetId,
            text: tweet.text.substring(0, 300),
            urls: allowedUrls,
            profile,
            foundAt: new Date().toISOString()
          });
        }
      }
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await new Promise(r => setTimeout(r, 2000));
  }

  return tweets;
}

async function monitorTwitterProfiles(profiles, { onLog, onUrlsFound, checkIntervalMin = 30000, checkIntervalMax = 60000 } = {}) {
  const log = (message, type = 'info') => {
    if (onLog) onLog({ timestamp: new Date().toISOString(), message, type });
  };

  let browser;
  let page;
  let stopped = false;
  const seenTweets = new Set();
  const profileHandles = profiles.map(p => {
    // Extract handle from URL if full URL provided
    const match = p.match(/(?:twitter\.com|x\.com)\/([^\/\s]+)/);
    return match ? match[1].replace('@', '') : p.replace('@', '');
  });

  try {
    log(`Starting Twitter monitor for ${profileHandles.length} profile(s): ${profileHandles.join(', ')}`);

    const chromePath = getChromeExecutablePath();
    const connectConfig = {
      headless: false,
      turnstile: true,
      fingerprint: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--start-minimized',
        '--window-position=9999,9999',
        '--window-size=800,600',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };

    if (chromePath) {
      connectConfig.customConfig = { executablePath: chromePath };
    }

    const { browser: realBrowser, page: realPage } = await connect(connectConfig);
    browser = realBrowser;
    page = realPage;
    await page.setViewport({ width: 1366, height: 900 });

    let cycleCount = 0;

    (async () => {
      while (!stopped) {
        cycleCount++;
        log(`Scan cycle #${cycleCount} starting...`);

        for (const handle of profileHandles) {
          if (stopped) break;

          try {
            const profileUrl = `https://x.com/${handle}`;
            await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            const found = await page.waitForSelector('article[data-tweet-id]', { timeout: 15000 })
              .then(() => true)
              .catch(() => false);

            if (!found) {
              log(`No tweets found for @${handle}, skipping`);
              continue;
            }

            const newTweets = await scrollAndCollectTweets(page, handle, { onLog, maxScrolls: 10 });

            if (newTweets.length > 0) {
              log(`Found ${newTweets.length} tweets with matching URLs from @${handle}`);
              
              for (const tweet of newTweets) {
                if (!seenTweets.has(tweet.tweetId)) {
                  seenTweets.add(tweet.tweetId);
                  
                  for (const url of tweet.urls) {
                    const platform = url.includes('pokemoncenter.com') ? 'pokemon' : 'target';
                    
                    log(`🔗 New product URL found: ${url} (${platform})`, 'success');
                    
                    if (onUrlsFound) {
                      await onUrlsFound({
                        url,
                        platform,
                        source: `@${handle}`,
                        tweetText: tweet.text,
                        tweetId: tweet.tweetId
                      });
                    }
                  }
                }
              }
            } else {
              log(`No new matching URLs from @${handle}`);
            }

            if (stopped) break;
            await new Promise(r => setTimeout(r, 3000)); // Delay between profiles

          } catch (err) {
            log(`Error processing @${handle}: ${err.message}`, 'error');
          }
        }

        if (stopped) break;
        const delay = checkIntervalMin + Math.random() * (checkIntervalMax - checkIntervalMin);
        log(`Cycle complete. Waiting ${Math.round(delay / 1000)}s until next scan...`);
        await new Promise(r => setTimeout(r, delay));
      }

      try { await browser.close(); } catch {}
      log('Twitter monitor stopped');
    })();

    return {
      stop: () => { stopped = true; },
      profileHandles
    };
  } catch (e) {
    log(`Failed to start Twitter monitor: ${e.message}`, 'error');
    return { stop: () => { stopped = true; }, profileHandles };
  }
}

module.exports = { monitorTwitterProfiles };