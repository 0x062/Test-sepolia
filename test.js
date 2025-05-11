// auto_faucet_bot.js
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const COOKIES_PATH = process.env.COOKIES_PATH
  ? path.resolve(__dirname, process.env.COOKIES_PATH)
  : path.resolve(__dirname, 'script-cookies.json');
const FAUCET_URL = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
const DUMP_HTML_PATH = path.resolve(__dirname, 'debug_after_claim.html');
const DUMP_SCREENSHOT_PATH = path.resolve(__dirname, 'debug_after_claim.png');

if (!WALLET_ADDRESS) {
  console.error('Error: WALLET_ADDRESS not set in .env');
  process.exit(1);
}

(async () => {
  try {
    // Function to refresh cookies by manual login
    async function refreshCookies(origin) {
      console.log('Opening browser for manual login...');
      const browser = await puppeteer.launch({ headless: false });
      const page = await browser.newPage();
      await page.goto(origin, { waitUntil: 'networkidle2' });
      console.log('Please complete Google login, then press ENTER in this terminal');
      await new Promise(resolve => {
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
      });
      const newCookies = await page.cookies();
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(newCookies, null, 2));
      console.log(`Saved cookies to ${COOKIES_PATH}`);
      await browser.close();
      return newCookies;
    }

    // Determine or refresh cookies
    const origin = new URL(FAUCET_URL).origin;
    let loadedCookies;
    if (!fs.existsSync(COOKIES_PATH)) {
      loadedCookies = await refreshCookies(origin);
    } else {
      loadedCookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
      console.log(`Loaded ${loadedCookies.length} cookies from ${COOKIES_PATH}`);
    }

    // 1. Launch headless browser and apply cookies
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'networkidle2' });
    await page.setCookie(...loadedCookies);
    console.log('Cookies set, reloading to apply session...');
    await page.reload({ waitUntil: 'networkidle2' });

    // 2. Check for Sign In button indicating expired session
    const signIn = await page.$x("//button[contains(., 'Sign in')] | //a[contains(., 'Sign in')]");
    if (signIn.length > 0) {
      console.log('Sign in button detected. Session expired or not logged in. Refreshing cookies...');
      await browser.close();
      loadedCookies = await refreshCookies(origin);
      // Relaunch headless browser with new cookies
      const newBrowser = await puppeteer.launch({ headless: true });
      const newPage = await newBrowser.newPage();
      await newPage.goto(origin, { waitUntil: 'networkidle2' });
      await newPage.setCookie(...loadedCookies);
      await newPage.reload({ waitUntil: 'networkidle2' });
      page = newPage;
      browser = newBrowser;
    }

    // 3. Navigate to faucet page
    await page.goto(FAUCET_URL, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${FAUCET_URL}`);

    // 4. Fill wallet address
    const inputs = await page.$$('input');
    const input = await findFirstVisible(inputs, page);
    if (!input) throw new Error('No visible input found');
    await input.click({ clickCount: 3 });
    await input.type(WALLET_ADDRESS, { delay: 100 });
    console.log('Entered wallet address');

    // 5. Click Receive button via XPath
    const [btn] = await page.$x("//button[contains(., 'Receive 0.05 Sepolia ETH')]");
    if (!btn) throw new Error('Receive button not found');
    await btn.click();
    console.log('Clicked "Receive 0.05 Sepolia ETH" button');

    // 6. Debug dump
    await page.screenshot({ path: DUMP_SCREENSHOT_PATH, fullPage: true });
    fs.writeFileSync(
      DUMP_HTML_PATH,
      await page.evaluate(() => document.body.innerHTML),
      'utf-8'
    );
    console.log('Dumped HTML & screenshot');

    // 7. Wait for transaction hash
    const txHash = await page.evaluate(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for TX hash')), 120000);
      const obs = new MutationObserver(() => {
        const link = document.querySelector('a[href*="etherscan.io/tx"]');
        if (link?.textContent.trim()) {
          clearTimeout(timeout);
          obs.disconnect();
          resolve(link.textContent.trim());
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }));
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();

// Helper: find first visible element
async function findFirstVisible(handles, page) {
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (box && box.width > 0 && box.height > 0) return handle;
  }
  return null;
}
