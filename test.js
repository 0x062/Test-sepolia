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
    // 1. Load cookies or instruct manual refresh
    if (!fs.existsSync(COOKIES_PATH)) {
      console.error('Cookie file not found. Please login manually and save cookies to', COOKIES_PATH);
      process.exit(1);
    }
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies`);

    // 2. Launch headless browser
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    // 3. Apply cookies and validate session
    const origin = new URL(FAUCET_URL).origin;
    await page.goto(origin, { waitUntil: 'networkidle2' });
    await page.setCookie(...cookies);
    await page.reload({ waitUntil: 'networkidle2' });

    const needsLogin = await page.evaluate(() => {
      return !!Array.from(document.querySelectorAll('button, a')).find(el => /sign\s?in/i.test(el.textContent));
    });
    if (needsLogin) {
      console.error('Session invalid or expired. Please refresh cookies manually.');
      await browser.close();
      process.exit(1);
    }
    console.log('Session is valid');

    // 4. Navigate to faucet page
    await page.goto(FAUCET_URL, { waitUntil: 'networkidle2' });
    console.log('At faucet page');

    // 5. Enter wallet address
    await page.waitForSelector('input', { visible: true });
    await page.click('input', { clickCount: 3 });
    await page.type('input', WALLET_ADDRESS, { delay: 100 });
    console.log('Wallet address entered');

    // 6. Click Receive button
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.includes('Receive') && b.textContent.includes('Sepolia')
      );
      if (!btn) throw new Error('Receive button not found');
      btn.click();
    });
    console.log('Clicked Receive button');

    // 7. Debug dump
    await page.screenshot({ path: DUMP_SCREENSHOT_PATH, fullPage: true });
    fs.writeFileSync(DUMP_HTML_PATH, await page.content(), 'utf-8');
    console.log('Saved debug dump');

    // 8. Wait for transaction hash
    const txHash = await page.evaluate(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('TX hash timeout')), 120000);
      const obs = new MutationObserver(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a => /etherscan\.io\/tx/.test(a.href));
        if (link) {
          clearTimeout(timeout);
          obs.disconnect();
          resolve(link.textContent.trim());
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }));
    console.log(`Claim successful: ${txHash}`);

    await browser.close();
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
