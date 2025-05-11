// Load environment variables
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(__dirname, 'script-cookies.json');

if (!WALLET_ADDRESS) {
  console.error('Error: WALLET_ADDRESS not set in .env');
  process.exit(1);
}

(async () => {
  try {
    // Debug cookie path
    console.log('ENV COOKIES_PATH =', process.env.COOKIES_PATH);
    console.log('Resolved cookies path =', path.resolve(__dirname, process.env.COOKIES_PATH));

    // Load cookies
    if (!fs.existsSync(path.resolve(__dirname, process.env.COOKIES_PATH))) {
      throw new Error(`${process.env.COOKIES_PATH} not found.`);
    }
    const cookies = JSON.parse(fs.readFileSync(path.resolve(__dirname, process.env.COOKIES_PATH), 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies.`);

    // Launch browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setCookie(...cookies);

    // Navigate to faucet
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${faucetUrl}`);

    // Wait for the web3-faucet custom element to load
    await page.waitForSelector('web3-faucet', { timeout: 60000 });

    // Fill wallet address via shadow DOM
    await page.evaluate((addr) => {
      const faucet = document.querySelector('web3-faucet');
      const input = faucet.shadowRoot.querySelector('input');
      input.value = addr;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('Wallet address set in shadow DOM');
    }, WALLET_ADDRESS);

    // Click the claim button via shadow DOM
    await page.evaluate(() => {
      const faucet = document.querySelector('web3-faucet');
      const button = faucet.shadowRoot.querySelector('button');
      button.click();
      console.log('Clicked claim button in shadow DOM');
    });

    // Wait and extract transaction hash
    await page.waitForFunction(() => {
      const faucet = document.querySelector('web3-faucet');
      const link = faucet.shadowRoot.querySelector('a[href*="etherscan.io/tx"]');
      return link && link.textContent.trim().length > 0;
    }, { timeout: 60000 });

    const txHash = await page.evaluate(() => {
      const faucet = document.querySelector('web3-faucet');
      return faucet.shadowRoot.querySelector('a[href*="etherscan.io/tx"]').textContent.trim();
    });
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
