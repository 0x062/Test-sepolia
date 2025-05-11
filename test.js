// auto_faucet_bot.js
// Node.js script to auto-claim Sepolia ETH from Google Cloud Web3 Faucet

require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const winston = require('winston');

// ================= Configuration =================
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const COOKIES_PATH = process.env.COOKIES_PATH
  ? path.resolve(__dirname, process.env.COOKIES_PATH)
  : path.resolve(__dirname, 'script-cookies.json');
const FAUCET_URL = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
const DUMP_HTML_PATH = path.resolve(__dirname, 'debug_after_claim.html');
const DUMP_SCREENSHOT_PATH = path.resolve(__dirname, 'debug_after_claim.png');
const CLAIM_CRON_SCHEDULE = process.env.CLAIM_CRON || '0 * * * *'; // default: every hour at minute 0
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10) || 3;

if (!WALLET_ADDRESS) {
  console.error('Error: WALLET_ADDRESS not set in .env');
  process.exit(1);
}

// Setup logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [new winston.transports.Console(), new winston.transports.File({ filename: 'bot.log' })]
});

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_PATH)) {
    throw new Error(`Cookie file not found at ${COOKIES_PATH}`);
  }
  const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
  await page.setCookie(...cookies);
  logger.info(`Loaded and set ${cookies.length} cookies`);
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  logger.info(`Saved ${cookies.length} cookies to ${COOKIES_PATH}`);
}

async function claimOnce() {
  let browser;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      browser = await puppeteer.launch({ headless: true });
      const page = await browser.newPage();
      const origin = new URL(FAUCET_URL).origin;
      await page.goto(origin, { waitUntil: 'networkidle2' });
      await loadCookies(page);
      await page.reload({ waitUntil: 'networkidle2' });
      await page.goto(FAUCET_URL, { waitUntil: 'networkidle2' });

      // Enter wallet address
      const inputs = await page.$$('input');
      const input = await findFirstVisible(inputs, page);
      if (!input) throw new Error('No visible input found');
      await input.click({ clickCount: 3 });
      await input.type(WALLET_ADDRESS, { delay: 50 });
      logger.info('Entered wallet address');

            // Click claim button via shadow DOM and text matching
      await page.evaluate(() => {
        const faucetEl = document.querySelector('web3-faucet');
        if (!faucetEl) throw new Error('Cannot find web3-faucet element');
        const root = faucetEl.shadowRoot;
        const buttons = root.querySelectorAll('button');
        const target = Array.from(buttons).find(b => b.textContent.includes('Receive 0.05 Sepolia ETH'));
        if (!target) throw new Error('Receive button not found in shadow DOM');
        target.click();
      });
      logger.info('Clicked "Receive 0.05 Sepolia ETH" button');('Clicked "Receive 0.05 Sepolia ETH" button');

      // Optional debug dumps
      await page.screenshot({ path: DUMP_SCREENSHOT_PATH, fullPage: true });
      fs.writeFileSync(DUMP_HTML_PATH, await page.evaluate(() => document.body.innerHTML));
      logger.info('Dumped HTML and screenshot for debugging');

      // Wait for TX hash
      const txHash = await page.evaluate(() => {
        const faucet = document.querySelector('web3-faucet');
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout waiting for TX hash')), 120_000);
          const obs = new MutationObserver(() => {
            const link = faucet.shadowRoot.querySelector('a[href*="etherscan.io/tx"]');
            if (link?.textContent.trim()) {
              clearTimeout(timeout);
              obs.disconnect();
              resolve(link.textContent.trim());
            }
          });
          obs.observe(faucet.shadowRoot, { childList: true, subtree: true });
        });
      });
      logger.info(`✅ Claimed! TX hash: ${txHash}`);

      // Save updated cookies
      await saveCookies(page);
      await browser.close();
      return;
    } catch (err) {
      logger.error(`Attempt ${attempt} failed: ${err.message}`);
      if (browser) await browser.close();
      if (attempt === MAX_RETRIES) throw err;
      logger.info(`Retrying in 15 seconds... (${attempt}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

// Utility: find first visible element
async function findFirstVisible(handles, page) {
  for (const handle of handles) {
    const box = await handle.boundingBox();
    if (box && box.width > 0 && box.height > 0) return handle;
  }
  return null;
}

// Schedule recurring claims
logger.info(`Scheduling faucet claim with cron pattern: ${CLAIM_CRON_SCHEDULE}`);
cron.schedule(CLAIM_CRON_SCHEDULE, () => {
  logger.info('Starting scheduled claim');
  claimOnce().catch(err => logger.error(`Scheduled claim error: ${err.message}`));
});

// Run immediately on start
claimOnce().catch(err => logger.error(`Initial claim error: ${err.message}`));
