// Headless smoke test + screenshots.  Usage:
//   npm i playwright-core   (or playwright)  &&  node tools/screenshots.mjs [url] [outDir]
// Uses the system Chrome/Chromium (CHROME_PATH env) with SwiftShader WebGL.
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://127.0.0.1:8765/';
const out = process.argv[3] || 'screenshots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nohelp&q=high', { waitUntil: 'load' });
await page.waitForFunction(() => window.__appReady === true, null, { timeout: 60000 });
await sleep(2500);
await page.screenshot({ path: `${out}/01-drive.png` });

// drive with force vectors
await page.keyboard.press('KeyF');
await page.keyboard.down('KeyW'); await sleep(2500);
await page.keyboard.down('KeyA'); await sleep(700); await page.keyboard.up('KeyA');
await page.screenshot({ path: `${out}/02-drive-forces.png` });
await page.keyboard.up('KeyW'); await page.keyboard.press('KeyF');

// battery cutaway while accelerating
await page.click('#tabs button[data-mode=battery]');
await page.keyboard.down('KeyW'); await sleep(2600);
await page.screenshot({ path: `${out}/03-battery-xray.png` });
await page.keyboard.up('KeyW');

// aero
await page.click('#tabs button[data-mode=aero]');
await sleep(2600);
await page.screenshot({ path: `${out}/04-aero.png` });

// materials
await page.click('#tabs button[data-mode=materials]');
await sleep(2500); await page.click('#btnScratch'); await sleep(1800);
await page.screenshot({ path: `${out}/05-materials.png` });

const stats = await page.evaluate(() => ({ v: window.__sim.v, soc: window.__sim.soc, t: window.__sim.time }));
console.log('sim stats', JSON.stringify(stats));
console.log(errors.length ? 'CONSOLE ISSUES:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
// mobile layout check
await page.close();
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
m.on('pageerror', (e) => errors.push('[mobile pageerror] ' + e.message));
await m.goto(url + (url.includes('?') ? '&' : '?') + 'nohelp', { waitUntil: 'load', timeout: 120000 });
await m.waitForFunction(() => window.__appReady === true, null, { timeout: 60000 });
await sleep(2500);
await m.screenshot({ path: `${out}/06-mobile.png` });
console.log(errors.length ? 'ISSUES AFTER MOBILE:\n' + errors.join('\n') : 'MOBILE OK');
await browser.close();
