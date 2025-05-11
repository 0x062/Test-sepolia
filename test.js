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
    //    cari input pertama yang terlihat
    const inputs = await page.$$('input');
    const input = inputs.find(async h => {
      const b = await h.boundingBox();
      return b && b.width > 0 && b.height > 0;
    });
    if (!input) throw new Error('No visible input found');
    await input.click({ clickCount: 3 });
    await input.type(WALLET_ADDRESS, { delay: 100 });
    console.log('Entered wallet address');

    // 5. Klik tombol Claim pertama yang terlihat
    const buttons = await page.$$('button');
    const btn = buttons.find(async h => {
      const b = await h.boundingBox();
      return b && b.width > 0 && b.height > 0;
    });
    if (!btn) throw new Error('No visible button found');
    await btn.click();
    console.log('Clicked claim button');

    // 6. (Debug) ambil screenshot dan dump HTML sebelum menunggu TX
    await page.screenshot({ path: 'debug_after_claim.png', fullPage: true });
    console.log('DEBUG HTML snippet:', (await page.evaluate(() => document.body.innerHTML))).slice(0,200);

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
