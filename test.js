// Full script to automate Google Cloud Web3 Faucet Sepolia claim using Puppeteer
// Prerequisites:
// 1. Node.js installed
// 2. Run `npm init -y` and `npm install puppeteer` in this folder
// 3. Place your exported cookies.json here (from cloud.google.com)

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ================= Configuration =================
// Replace with your Sepolia wallet address where faucet funds should be sent
const WALLET_ADDRESS = '0xYourSepoliaAddressHere';

(async () => {
  try {
    // 1. Load cookies from cookies.json
    const cookiesPath = path.resolve(__dirname, 'cookies.json');
    if (!fs.existsSync(cookiesPath)) {
      throw new Error('cookies.json not found. Export and place cookies.json in this folder.');
    }
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));

    // 2. Launch headless browser
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // 3. Set cookies for cloud.google.com domain
    await page.setCookie(...cookies);

    // 4. Navigate to the Sepolia faucet page
    const faucetUrl = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
    await page.goto(faucetUrl, { waitUntil: 'networkidle2' });
    console.log(`Navigated to ${faucetUrl}`);

    // 5. Fill wallet address input
    // Wait for the wallet address input field (adjust the selector if needed)
    const addressSelector = 'input[aria-label="Wallet address"]';
    await page.waitForSelector(addressSelector, { timeout: 60000 });
    await page.click(addressSelector);
    await page.type(addressSelector, WALLET_ADDRESS);
    console.log(`Entered wallet address: ${WALLET_ADDRESS}`);

    // 6. Wait for and click the "Claim Sepolia ETH" button
    const claimSelector = 'button[aria-label="Claim Sepolia ETH"]';
    await page.waitForSelector(claimSelector, { timeout: 60000 });
    await page.click(claimSelector);
    console.log('Clicked claim button.');

    // 7. Wait for the transaction link to appear and extract TX hash
    const txSelector = 'a[href*="etherscan.io/tx"]';
    await page.waitForSelector(txSelector, { timeout: 60000 });
    const txHash = await page.$eval(txSelector, el => el.textContent.trim());
    console.log(`✅ Claimed! TX hash: ${txHash}`);

    // 8. Close browser
    await browser.close();
  } catch (error) {
    console.error('Error during faucet claim:', error);
    process.exit(1);
  }
})();
