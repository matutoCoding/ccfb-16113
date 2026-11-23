import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5192, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:5192/scripts/webgl-debug.html');
await page.waitForFunction(() => window.__DEBUG__ !== undefined, { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(() => window.__DEBUG__), null, 2));
if (errors.length) console.log('ERRORS:', errors.join('\n'));
await browser.close();
await server.close();
