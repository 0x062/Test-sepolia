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
    // Manual login to refresh cookies if needed
    async function refreshCookies(origin) {
      console.log('Please login in the opened browser window...');
      const browserManual = await puppeteer.launch({ headless: false });
      const pageManual = await browserManual.newPage();
      await pageManual.goto(origin, { waitUntil: 'networkidle2' });
      console.log('Complete login and then press ENTER here.');
      await new Promise(resolve => process.stdin.once('data', resolve));
      const newCookies = await pageManual.cookies();
      fs.writeFileSync(COOKIES_PATH, JSON.stringify(newCookies, null, 2));
      await browserManual.close();
      return newCookies;
    }

    // Prepare cookies
    const origin = new URL(FAUCET_URL).origin;
    let cookies;
    if (!fs.existsSync(COOKIES_PATH)) {
      cookies = await refreshCookies(origin);
    } else {
      cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
      console.log(`Loaded ${cookies.length} cookies`);
    }

    // Launch headless
    let browser = await puppeteer.launch({ headless: true });
    let page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'networkidle2' });
    await page.setCookie(...cookies);
    await page.reload({ waitUntil: 'networkidle2' });

    // Check login via evaluating sign-in button presence
    const needsLogin = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('button, a')).map(e => e.textContent || '');
      return texts.some(t => /Sign\s?in/i.test(t));
    });
    if (needsLogin) {
      console.log('Detected Sign in link/button. Cookies expired.');
      await browser.close();
      cookies = await refreshCookies(origin);
      browser = await puppeteer.launch({ headless: true });
      page = await browser.newPage();
      await page.goto(origin, { waitUntil: 'networkidle2' });
      await page.setCookie(...cookies);
      await page.reload({ waitUntil: 'networkidle2' });
    }

    // Navigate to faucet page
    await page.goto(FAUCET_URL, { waitUntil: 'networkidle2' });
    console.log('At faucet page');

    // Enter wallet address
    await page.waitForSelector('input', { visible: true });
    await page.type('input', WALLET_ADDRESS, { delay: 100 });
    console.log('Wallet address entered');

    // Click Receive button via evaluating in page context
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.includes('Receive') && b.textContent.includes('Sepolia')
      );
      if (!btn) throw new Error('Receive button not found');
      btn.click();
    });
    console.log('Clicked Receive button');

    // Debug dump
    await page.screenshot({ path: DUMP_SCREENSHOT_PATH, fullPage: true });
    fs.writeFileSync(DUMP_HTML_PATH, await page.content(), 'utf-8');
    console.log('Saved debug dump');

    // Wait for TX hash element
    const txHash = await page.evaluate(() => new Promise((resolve, reject) => {
      const obs = new MutationObserver(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a =>
          /etherscan\.io\/tx/.test(a.href)
        );
        if (link) {
          obs.disconnect();
          resolve(link.textContent.trim());
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => reject(new Error('TX hash timeout')), 120000);
    }));
    console.log(`Claim successful: ${txHash}`);

    await browser.close();
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
