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

    // 5. Klik tombol klaim via shadow DOM
    await page.evaluate(() => {
      const faucet = document.querySelector('web3-faucet');
      if (!faucet) throw new Error('web3-faucet element not found');
      const shadow = faucet.shadowRoot;
      const buttons = shadow.querySelectorAll('button');
      const btn = Array.from(buttons).find(b =>
        b.textContent.includes('Receive 0.05 Sepolia ETH')
      );
      if (!btn) throw new Error('Claim button not found');
      btn.click();
    });
    console.log('Clicked "Receive 0.05 Sepolia ETH" button');

    // 6. Dump HTML & screenshot (optional)
    await page.screenshot({ path: DUMP_SCREENSHOT_PATH, fullPage: true });
    fs.writeFileSync(
      DUMP_HTML_PATH,
      await page.evaluate(() => document.body.innerHTML),
      'utf-8'
    );
    console.log('Dumped HTML & screenshot for debugging');

    // 7. Tunggu TX hash via MutationObserver
    let txHash;
    try {
      txHash = await page.evaluate(() => {
        const faucet = document.querySelector('web3-faucet');
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timeout: tidak dapat TX hash')),
            120_000
          );
          const obs = new MutationObserver(() => {
            const link = faucet.shadowRoot.querySelector(
              'a[href*="etherscan.io/tx"]'
            );
            if (link?.textContent.trim()) {
              clearTimeout(timeout);
              obs.disconnect();
              resolve(link.textContent.trim());
            }
          });
          obs.observe(faucet.shadowRoot, { childList: true, subtree: true });
        });
      });
      console.log(`✅ Claimed! TX hash: ${txHash}`);
    } catch (e) {
      console.error('Gagal mendapatkan TX hash:', e);
    }

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
