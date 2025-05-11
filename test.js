// Load environment variables
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
    // 1. Load cookies
    if (!fs.existsSync(COOKIES_PATH)) {
      throw new Error(`Cookie file not found at ${COOKIES_PATH}`);
    }
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies from ${COOKIES_PATH}`);

    // 2. Launch browser & set cookies
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const origin = new URL(FAUCET_URL).origin;
    await page.goto(origin, { waitUntil: 'networkidle2' });
    await page.setCookie(...cookies);
    console.log('Cookies set, refreshing to apply authentication...');
    await page.reload({ waitUntil: 'networkidle2' });

    // 3. Navigate to faucet
    await page.goto(FAUCET_URL, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${FAUCET_URL}`);

    // 4. Isi wallet address
    const inputs = await page.$$('input');
    const input = await findFirstVisible(inputs, page);
    if (!input) throw new Error('No visible input found');
    await input.click({ clickCount: 3 });
    await input.type(WALLET_ADDRESS, { delay: 100 });
    console.log('Entered wallet address');

    // 5. Klik tombol Claim
    const buttons = await page.$$('button');
    const btn = await findFirstVisible(buttons, page);
    if (!btn) throw new Error('No visible button found');
    await btn.click();
    console.log('Clicked claim button');

    // 6. Debug: take screenshot and dump HTML
    await page.screenshot({ path: DUMP_SCREENSHOT_PATH, fullPage: true });
    const bodyHTML = await page.evaluate(() => document.body.innerHTML);
    fs.writeFileSync(DUMP_HTML_PATH, bodyHTML, 'utf-8');
    console.log(`HTML dump saved to ${DUMP_HTML_PATH}`);
    console.log(`Screenshot saved to ${DUMP_SCREENSHOT_PATH}`);

    // 7. Tunggu dan ekstrak TX hash via piercing selector
    await page.waitForSelector(
      'pierce/web3-faucet >>> a[href*="etherscan.io/tx"]',
      { timeout: 120_000 }
    );
    const txHash = await page.$eval(
      'pierce/web3-faucet >>> a[href*="etherscan.io/tx"]',
      el => el.textContent.trim()
    );
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();

// Utility function for visibility check
async function findFirstVisible(handles, page) {
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      return handle;
    }
  }
  return null;
}
