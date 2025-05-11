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

    // Navigate to faucet
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${faucetUrl}`);

    // Reload to apply authentication cookies
    await page.reload({ waitUntil: 'networkidle2' });

    // Short wait for dynamic load
    await new Promise(res => setTimeout(res, 5000));

    // Try finding input on main page
    let context = page;
    let location = 'main page';
    const inputSelector = 'input[placeholder="Wallet address or ENS name*"]';
    if (!await page.$(inputSelector)) {
      // If not found, search in frames
      for (const frame of page.frames()) {
        if (await frame.$(inputSelector)) {
          context = frame;
          location = `frame ${frame.url()}`;
          console.log(`Found input in ${location}`);
          break;
        }
      }
    } else {
      console.log('Found input in main page');
    }

    // Ensure input found
    if (!await context.$(inputSelector)) {
      throw new Error('Input element not found in page or frames');
    }

    // Fill wallet address
    await context.type(inputSelector, WALLET_ADDRESS);
    console.log(`Entered wallet address in ${location}`);

    // Click claim button
    const buttonSelector = 'button';
    await context.waitForSelector(buttonSelector, { timeout: 60000 });
    await context.click(buttonSelector);
    console.log('Clicked claim button');

    // Wait and extract transaction hash
    await new Promise(res => setTimeout(res, 5000));
    const txSelector = 'a[href*="etherscan.io/tx"]';
    let txHash = await context.$eval(txSelector, el => el.textContent.trim()).catch(() => null);
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
