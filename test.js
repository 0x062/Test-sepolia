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

    // Launch browser and set cookies
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setCookie(...cookies);

    // Navigate and reload
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    await page.reload({ waitUntil: 'networkidle2' });
    console.log(`Loaded and reloaded ${faucetUrl}`);

    // Wait for dynamic load
    await new Promise(res => setTimeout(res, 5000));

    // DEBUG: list all placeholders in main page
    const placeholders = await page.$$eval('[placeholder]', els =>
      els.map(el => ({ tag: el.tagName, placeholder: el.getAttribute('placeholder') }))
    );
    console.log('Placeholders on main page:', placeholders);

    // DEBUG: list placeholders in each frame
    for (const frame of page.frames()) {
      try {
        const phs = await frame.$$eval('[placeholder]', els =>
          els.map(el => ({ tag: el.tagName, placeholder: el.getAttribute('placeholder') }))
        );
        console.log(`Placeholders in frame ${frame.url()}:`, phs);
      } catch (e) {}
    }

    // After inspecting logs, set the correct selector below:
    const addressSelector = 'input[placeholder="Wallet address or ENS name*"]'; // adjust as needed
    const buttonSelector = 'button'; // adjust if needed

    // Validate selector
    if (!await page.$(addressSelector) && !page.frames().some(f => f.$(addressSelector))) {
      throw new Error(`Selector ${addressSelector} not found; please update based on placeholders.`);
    }

    // Fill address and click claim
    await page.type(addressSelector, WALLET_ADDRESS);
    console.log('Entered wallet address');
    await page.click(buttonSelector);
    console.log('Clicked claim button');

    // Wait and extract TX hash
    await new Promise(res => setTimeout(res, 5000));
    const txHash = await page.$eval('a[href*="etherscan.io/tx"]', el => el.textContent.trim());
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
