// Automated E2E check for the wallet-shim fixture dApp, driven directly via
// puppeteer-core against the Chrome binary that `agent-browser install`
// already downloaded on this machine. See test/e2e.md for the manual
// agent-browser recipe this mirrors.
//
// Usage:
//   node test/e2e.mjs [path/to/shim.out.js]
//
// Env:
//   WALLET_SHIM_CHROME  override path to chrome.exe
//   FIXTURE_URL          override fixture base URL (default http://localhost:3000)

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const EXPECTED_METHODS = [
  'eth_requestAccounts',
  'eth_chainId',
  'personal_sign',
  'eth_sendTransaction',
  'eth_getTransactionReceipt',
];

const chromePath =
  process.env.WALLET_SHIM_CHROME ||
  join(homedir(), '.agent-browser', 'browsers', 'chrome-152.0.7977.54', 'chrome.exe');

if (!existsSync(chromePath)) {
  console.error(`[e2e] Chrome executable not found at: ${chromePath}`);
  console.error('[e2e] Set WALLET_SHIM_CHROME to override, or run `npx agent-browser install`.');
  process.exit(1);
}

const shimPath = process.argv[2] || '.wallet-shim/shim.out.js';
if (!existsSync(shimPath)) {
  console.error(`[e2e] Shim script not found at: ${shimPath}`);
  process.exit(1);
}
const shimSource = readFileSync(shimPath, 'utf8');

const baseUrl = process.env.FIXTURE_URL || 'http://localhost:3000';

async function waitFor(page, fn, { timeoutMs, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(fn);
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function clickConnectMetaMask(page) {
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Connect MetaMask'),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) throw new Error('Connect MetaMask button not found');
}

async function readResult(page) {
  return page.evaluate(() => ({
    status: document.getElementById('status')?.textContent ?? null,
    log: document.getElementById('log')?.textContent ?? '',
    methods: (window.__WALLET_SHIM__?.calls ?? []).map((c) => c.method),
    txCount: (window.__WALLET_SHIM__?.txs ?? []).length,
  }));
}

function checkMethods(methods) {
  return EXPECTED_METHODS.every((m) => methods.includes(m));
}

async function runSectionA(browser) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(shimSource);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await waitFor(page, () => document.getElementById('log')?.textContent?.includes('detected: MetaMask'), {
    timeoutMs: 20000,
  });

  await clickConnectMetaMask(page);

  await waitFor(
    page,
    () => {
      const s = document.getElementById('status')?.textContent;
      return s === 'DONE' || s === 'ERROR';
    },
    { timeoutMs: 60000 },
  );

  const result = await readResult(page);
  await page.close();
  return result;
}

async function runSectionB(browser) {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const preInjectLog = await page.evaluate(() => document.getElementById('log')?.textContent ?? '');
  const alreadyDetected = preInjectLog.includes('detected:');

  await page.evaluate(shimSource);

  await waitFor(page, () => document.getElementById('log')?.textContent?.includes('detected: MetaMask'), {
    timeoutMs: 20000,
  });

  await clickConnectMetaMask(page);

  await waitFor(
    page,
    () => {
      const s = document.getElementById('status')?.textContent;
      return s === 'DONE' || s === 'ERROR';
    },
    { timeoutMs: 60000 },
  );

  const result = await readResult(page);
  result.alreadyDetectedBeforeInject = alreadyDetected;
  await page.close();
  return result;
}

function printSummary(name, result) {
  console.log(`\n[${name}] status=${result.status} methods=${JSON.stringify(result.methods)} txCount=${result.txCount}`);
  if ('alreadyDetectedBeforeInject' in result) {
    console.log(`[${name}] detected before injection (should be false): ${result.alreadyDetectedBeforeInject}`);
  }
}

let browser;
let exitCode = 0;
try {
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true });

  const resultA = await runSectionA(browser);
  printSummary('Section A (load-before)', resultA);

  const resultB = await runSectionB(browser);
  printSummary('Section B (load-after)', resultB);

  const okA = resultA.status === 'DONE' && checkMethods(resultA.methods);
  const okB = resultB.status === 'DONE' && checkMethods(resultB.methods);

  if (!okA || !okB) {
    console.error('\n[e2e] FAILED: one or both sections did not reach DONE with the expected methods.');
    exitCode = 1;
  } else {
    console.log('\n[e2e] OK: both sections reached DONE with all expected methods.');
  }
} catch (err) {
  console.error(`\n[e2e] ERROR: ${err.message}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
}

process.exit(exitCode);
