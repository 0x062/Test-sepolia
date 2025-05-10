// Load environment variables
require('dotenv').config();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
// Ensure you have .env file with WALLET_ADDRESS and optional COOKIES_PATH
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const COOKIES_PATH = process.env.COOKIES_PATH || path.resolve(__dirname, 'cookies.json');

if (!WALLET_ADDRESS) {
  console.error('Error: WALLET_ADDRESS not set in .env');
  process.exit(1);
}

(async () => {
  try {
    // 1. Load cookies
    if (!fs.existsSync(COOKIES_PATH)) {
      throw new Error(`${COOKIES_PATH} not found. Please export your cookies.json.`);
    }
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
    console.log(`Loaded ${cookies.length} cookies.`);

    // 2. Launch browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // 3. Set cookies for domain
    await page.setCookie(...cookies);

    // 4. Navigate to faucet page
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${faucetUrl}`);

    // 5. Detect iframe and switch context
    const frameHandle = await page.waitForSelector('iframe', { timeout: 60000 });
    const frame = await frameHandle.contentFrame();
    if (!frame) {
      throw new Error('Failed to get iframe content frame');
    }

    // 6. List all input elements for debugging selector
    const inputs = await frame.$$eval('input', els =>
      els.map(el => el.outerHTML)
    );
    console.log('List of input elements in iframe:');
    inputs.forEach(html => console.log(html));

    // 7. Define selectors (adjust if needed based on the list above)
    const addressSelector = 'input[aria-label="Wallet address"]';
    const claimSelector = 'button[aria-label="Claim Sepolia ETH"]';

    // 8. Fill wallet address
    await frame.waitForSelector(addressSelector, { timeout: 60000 });
    await frame.click(addressSelector);
    await frame.type(addressSelector, WALLET_ADDRESS);
    console.log(`Entered wallet address: ${WALLET_ADDRESS}`);

    // 9. Click claim button
    await frame.waitForSelector(claimSelector, { timeout: 60000 });
    await frame.click(claimSelector);
    console.log('Clicked claim button');

    // 10. Wait for and extract transaction hash
    const txSelector = 'a[href*="etherscan.io/tx"]';
    await frame.waitForSelector(txSelector, { timeout: 60000 });
    const txHash = await frame.$eval(txSelector, el => el.textContent.trim());
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    await browser.close();
  } catch (error) {
    console.error('Error during faucet automation:', error);
    process.exit(1);
  }
})();
