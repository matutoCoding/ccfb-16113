// 无头浏览器跑 WebGL2 半立方体数值验证(纯 ESM JS)
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  server: { port: 5191, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const url = 'http://127.0.0.1:5191/scripts/webgl-check.html';

const browser = await chromium.launch({
  args: ['--use-angle=gl', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(
  () => window.__TEST_RESULT__ !== undefined,
  { timeout: 60000 },
);
const result = await page.evaluate(() => window.__TEST_RESULT__);

console.log(JSON.stringify(result, null, 2));
if (errors.length) console.log('PAGE ERRORS:', errors.join('\n'));
await browser.close();
await server.close();
const ok = result.ok === true && !errors.some(e => e.includes('WebGL'));
process.exit(ok ? 0 : 1);
