import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5194, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=gl', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:5194/scripts/webgl-debug3.html');
await page.waitForFunction(() => window.__DEBUG3__ !== undefined, { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(() => window.__DEBUG3__), null, 2));
if (errors.length) console.log('ERRORS:', errors.join('\n'));
await browser.close();
await server.close();
