import { chromium, devices } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
const device = devices['iPhone 13'];

const browser = await chromium.launch({
  headless: false,
  slowMo: config.slowMo ?? 50
});

const context = await browser.newContext({
  ...device,
  locale: 'zh-CN',
  timezoneId: config.timezone ?? 'Asia/Shanghai'
});

const page = await context.newPage();
await page.goto(config.url, { waitUntil: 'domcontentloaded' });

console.log('\n请在打开的浏览器里完成学校统一身份认证。');
console.log('登录成功并回到预约系统页面后，回到这个终端按回车保存登录态。\n');

const rl = createInterface({ input, output });
await rl.question('已完成登录后按回车继续...');
rl.close();

await context.storageState({ path: fileURLToPath(new URL('../storageState.json', import.meta.url)) });
console.log('\n已保存登录态到 storageState.json。');

await browser.close();
