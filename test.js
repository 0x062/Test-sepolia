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
    const cookiePath = path.resolve(__dirname, process.env.COOKIES_PATH);
    console.log('Resolved cookies path =', cookiePath);

    // Load cookies
    if (!fs.existsSync(cookiePath)) {
      throw new Error(`${process.env.COOKIES_PATH} not found.`);
    }
    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies.`);

    // Launch browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setCookie(...cookies);

    // Navigate to faucet page
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${faucetUrl}`);

    // Short delay to allow scripts to load
    await new Promise(res => setTimeout(res, 5000));

    // Debug: list all frame URLs
    const frameUrls = page.frames().map(f => f.url());
    console.log('Frame URLs:');
    frameUrls.forEach((url, idx) => console.log(`${idx}: ${url}`));

    // Attempt to find web3-faucet element in main page
    let faucetHandle = await page.$('web3-faucet');
    if (faucetHandle) console.log('Found web3-faucet in main page');

    // Find frame containing web3-faucet
    let faucetFrame = page;
    if (!faucetHandle) {
      for (const frame of page.frames()) {
        try {
          if (await frame.$('web3-faucet')) {
            faucetFrame = frame;
            console.log('Found web3-faucet in frame:', frame.url());
            break;
          }
        } catch {}
      }
    }
    if (!await faucetFrame.$('web3-faucet')) {
      throw new Error('web3-faucet element not found in any frame or main page');
    }

    // Now operate within faucetFrame (could be page or specific frame)
    // Fill wallet address via shadow DOM using placeholder selector
    await faucetFrame.evaluate((addr) => {
      const faucet = document.querySelector('web3-faucet');
      const input = faucet.shadowRoot.querySelector('input[placeholder="Wallet address or ENS name*"]');
      if (!input) throw new Error('Input element not found');
      input.value = addr;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('Wallet address set');
    }, WALLET_ADDRESS);

    // Click claim button via shadow DOM
    await faucetFrame.evaluate(() => {
      const faucet = document.querySelector('web3-faucet');
      const button = faucet.shadowRoot.querySelector('button');
      if (!button) throw new Error('Claim button not found');
      button.click();
      console.log('Clicked claim');
    });

    // Delay and extract transaction hash
    await new Promise(res => setTimeout(res, 5000));
    const txHash = await faucetFrame.evaluate(() => {
      const faucet = document.querySelector('web3-faucet');
      const link = faucet.shadowRoot.querySelector('a[href*="etherscan.io/tx"]');
      return link ? link.textContent.trim() : null;
    });
    if (!txHash) {
      throw new Error('Transaction hash not found');
    }
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
