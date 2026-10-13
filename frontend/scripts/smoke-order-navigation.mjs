// Real-browser Arc mainnet read-only smoke test.
// Uses a simulated EIP-1193 account solely for wallet listing (never signs).
// Runs against the QA preview; does not broadcast, spend, or request signatures.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.SELDRA_SMOKE_URL;
if (!base?.startsWith('https://')) throw new Error('SELDRA_SMOKE_URL must be an HTTPS preview URL');
const root = base.replace(/\/$/, '');
const address = '0x7BE2440da225495735957B4b206A4ab4998372Fa';
const buyer = '0xd0dd02322AF812fC0dbDdC69f9a055FBBe2C6673';
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
await mkdir('smoke-artifacts', { recursive: true });

async function makePage(name, viewport, mockWallet) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(name + ': ' + error.message));
  if (mockWallet) {
    await page.addInitScript(({ account }) => {
      // Test-only, read-only account provider. Does not implement signing.
      window.ethereum = {
        request: async ({ method }) => {
          if (method === 'eth_chainId') return '0x13b2';
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
          if (method === 'wallet_switchEthereumChain') return null;
          throw new Error('Test provider forbids ' + method);
        },
        on: () => {}, removeListener: () => {},
      };
    }, { account: buyer });
  }
  return page;
}

const waitForPreview = async (page, path) => {
  for (let attempt = 1; attempt <= 9; attempt++) {
    const res = await page.goto(root + path, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    if (res?.status() === 200 && (await page.title()).includes('Seldra')) return;
    console.log('PREVIEW_WAIT', attempt, res?.status(), (await page.title()).slice(0,80));
    await page.waitForTimeout(3500);
  }
  throw new Error('Preview did not return a public Seldra page');
};

async function verifiedDetail(page, suffix) {
  await page.locator('.order-focus-page').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Back to all orders' }).waitFor({ timeout: 15_000 });
  await page.getByText('VERIFIED / OFFICIAL FACTORY', { exact: false }).waitFor({ timeout: 45_000 });
  await page.locator('.order-current-state').getByText('CREATED', { exact: true }).waitFor({ timeout: 25_000 });
  await page.screenshot({ path: 'smoke-artifacts/' + suffix + '.png', fullPage: true });
}

try {
  const desktop = await makePage('desktop', { width: 1440, height: 900 }, true);
  await waitForPreview(desktop, '/#orders');
  await desktop.getByRole('button', { name: /^Connect wallet$/i }).first().click();
  await desktop.locator('.ledger-row').first().waitFor({ timeout: 35_000 });
  const label = await desktop.locator('.ledger-row').first().getAttribute('aria-label');
  if (!label?.toLowerCase().includes('open purchase order')) throw new Error('Order row lacks accessible navigation');
  await desktop.locator('.ledger-row').first().click();
  if (!desktop.url().includes('#orders/0x')) throw new Error('Ledger row did not navigate to order URL');
  await verifiedDetail(desktop, 'desktop-open-order');
  await desktop.getByRole('button', { name: 'Back to all orders' }).click();
  if (!desktop.url().endsWith('#orders')) throw new Error('Back control did not restore register URL');
  await desktop.locator('.ledger-row').first().waitFor({ timeout: 15_000 });
  console.log('DESKTOP_REGISTER_OPEN_BACK_OK');

  const mobile = await makePage('mobile', { width: 390, height: 844 }, false);
  await waitForPreview(mobile, '/#orders/' + address + '/24754291');
  await verifiedDetail(mobile, 'mobile-direct-order');
  await mobile.getByRole('button', { name: 'Back to all orders' }).click();
  if (!mobile.url().endsWith('#orders')) throw new Error('Mobile Back control failed');
  console.log('MOBILE_DIRECT_LINK_BACK_OK');

  if (errors.length) throw new Error('Uncaught browser page errors: ' + errors.join(' | '));
  console.log('ORDER_UI_SMOKE_PASS');
} catch (error) {
  console.error('ORDER_UI_SMOKE_FAIL', error.stack || error);
  console.error('PAGE_ERRORS', errors.slice(0, 8));
  process.exitCode = 1;
} finally {
  await browser.close();
}
