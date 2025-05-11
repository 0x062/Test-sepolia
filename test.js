// Load environment variables
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(__dirname, 'script-cookies.json');
const FAUCET_URL = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';

if (!WALLET_ADDRESS) {
  console.error('Error: WALLET_ADDRESS not set in .env');
  process.exit(1);
}

(async () => {
  try {
    // Resolve and load cookies
    const cookiePath = path.resolve(__dirname, process.env.COOKIES_PATH);
    if (!fs.existsSync(cookiePath)) {
      throw new Error(`Cookie file not found at ${cookiePath}`);
    }
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies from ${cookiePath}`);

    // Launch browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Navigate to origin of cookies to set them properly, then refresh
    const origin = new URL(FAUCET_URL).origin;
    await page.goto(origin, { waitUntil: 'networkidle2' });
    await page.setCookie(...cookies);
    console.log('Cookies set, refreshing to apply authentication...');
    await page.reload({ waitUntil: 'networkidle2' });

    // Navigate to faucet page and ensure content is loaded
    await page.goto(FAUCET_URL, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    console.log(`Navigated and reloaded ${FAUCET_URL}`);

    // Short delay for dynamic scripts
    await new Promise(res => setTimeout(res, 3000));

    // Utility to find first visible element
    async function findFirstVisible(handles) {
      for (const handle of handles) {
        const box = await handle.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          return handle;
        }
      }
      return null;
    }

    // Fill wallet address
    const inputHandles = await page.$$('input');
    const inputHandle = await findFirstVisible(inputHandles);
    if (!inputHandle) throw new Error('No visible input found');
    await inputHandle.click({ clickCount: 3 });
    await inputHandle.type(WALLET_ADDRESS, { delay: 100 });
    console.log('Entered wallet address');

    // Click claim button
    const buttonHandles = await page.$$('button');
    const buttonHandle = await findFirstVisible(buttonHandles);
    if (!buttonHandle) throw new Error('No visible button found');
    await buttonHandle.click();
    console.log('Clicked claim button');

    // Wait and extract transaction hash
    await new Promise(res => setTimeout(res, 5000));
    const txHash = await page.$eval('a[href*="etherscan.io/tx"]', el => el.textContent.trim());
    if (!txHash) throw new Error('Transaction hash not found');
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
