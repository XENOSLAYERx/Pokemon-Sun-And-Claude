import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), { timeout: 180000 });
await page.waitForTimeout(15000);
await page.screenshot({ path: '/tmp/claude-0/shots/10-vista.png' });
const s = await page.evaluate(() => ({
  biome: document.getElementById('v-biome')?.textContent,
  chunks: document.getElementById('v-chunks')?.textContent,
  tris: document.getElementById('v-tris')?.textContent,
  mons: document.getElementById('v-mons')?.textContent,
  nearby: document.getElementById('v-nearby')?.innerText,
}));
console.log(JSON.stringify(s, null, 1));
await browser.close();
