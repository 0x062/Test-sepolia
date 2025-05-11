// Load environment variables
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(__dirname, 'cookies.json');

if (!WALLET_ADDRESS) {
  console.error('Error: WALLET_ADDRESS not set in .env');
  process.exit(1);
}

(async () => {
  try {
    // Load cookies
    if (!fs.existsSync(COOKIES_PATH)) {
      throw new Error(`${COOKIES_PATH} not found. Export cookies.json first.`);
    }
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies.`);

    // Launch browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setCookie(...cookies);

    // Navigate to faucet
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${faucetUrl}`);

    // Detect iframe
    const frameHandle = await page.waitForSelector('iframe', { timeout: 60000 });
    const frame = await frameHandle.contentFrame();
    if (!frame) throw new Error('Cannot access iframe content');

    // Debug: list elements to find selectors
    console.log('Inputs:');
    (await frame.$$eval('input', els => els.map(e => e.outerHTML))).forEach(html => console.log(html));
    console.log('\nButtons:');
    (await frame.$$eval('button', els => els.map(e => e.outerHTML))).forEach(html => console.log(html));
    console.log('\nAnchors:');
    (await frame.$$eval('a', els => els.map(e => e.outerHTML))).forEach(html => console.log(html));

    // TODO: Adjust selectors below based on output above
    const addressSelector = 'input[aria-label="Wallet address"]';
    const claimSelector = 'button[aria-label="Claim Sepolia ETH"]';

    // Fill and claim
    await frame.waitForSelector(addressSelector, { timeout: 60000 });
    await frame.type(addressSelector, WALLET_ADDRESS);
    console.log(`Entered wallet address`);

    await frame.waitForSelector(claimSelector, { timeout: 60000 });
    await frame.click(claimSelector);
    console.log('Clicked claim');

    // Extract TX hash
    await frame.waitForSelector('a[href*="etherscan.io/tx"]', { timeout: 60000 });
    const txHash = await frame.$eval('a[href*="etherscan.io/tx"]', a => a.textContent.trim());
    console.log(`✅ TX Hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
