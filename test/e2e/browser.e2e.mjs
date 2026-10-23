// ブラウザで実際に遊ぶ E2E テスト（Playwright）。
// スマホ縦・PC の両方で、CPU と最後まで打って勝敗がつくこと、待った・再読み込みからの再開、
// 連珠ルールの禁じ手の × 表示と置けないことを確かめる。
// 実行: npm run test:e2e（初回は npx playwright install chromium が必要）
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const SHOTS = process.env.SHOTS; // スクリーンショットの保存先（任意）
let server;
let base;
let browser;

before(async () => {
  server = http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  const executablePath = process.env.PW_CHROMIUM || undefined;
  browser = await chromium.launch(executablePath ? { executablePath } : {});
});

after(async () => {
  await browser?.close();
  server?.close();
});

const PHONE = { width: 390, height: 844 };
const PC = { width: 1366, height: 820 };

async function open(settings, viewport = PHONE) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 700, isMobile: viewport.width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g/.test(`${m.text()} ${m.location()?.url}`) && errors.push(m.text()));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      localStorage.setItem('gomoku.settings.v1', JSON.stringify({ sound: false, confirm: 'off', ...s }));
      sessionStorage.setItem('seeded', '1');
    }
  }, settings);
  await page.goto(base);
  return { page, errors, ctx };
}

const game = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gomoku.game.v1')));

// 盤上の点 (x, y) をクリック（タップ）する
async function hit(page, x, y) {
  const box = await page.locator('#board').boundingBox();
  const T = 14 + 0.9 * 2;
  const px = box.x + ((0.9 + x) / T) * box.width;
  const py = box.y + ((0.9 + y) / T) * box.height;
  await page.mouse.click(px, py);
}

async function waitMyTurn(page) {
  await page.waitForFunction(() => {
    const g = JSON.parse(localStorage.getItem('gomoku.game.v1'));
    return g && (g.result || (g.moves.length % 2 === 0 ? 1 : 2) === g.player) && !document.querySelector('#thinking.on');
  }, null, { timeout: 15000 });
}

// 空いている点を中央に近い順に打っていく素朴な打ち手
async function playToEnd(page, maxMoves = 120) {
  for (let i = 0; i < maxMoves; i++) {
    await waitMyTurn(page);
    const g = await game(page);
    if (g.result) return g;
    const taken = new Set(g.moves);
    // 自分の最後の石の隣を優先する
    const mine = g.moves.filter((_, k) => (k % 2 === 0 ? 1 : 2) === g.player);
    const last = mine[mine.length - 1] ?? 112;
    const cands = [];
    for (let p = 0; p < 225; p++) {
      if (taken.has(p)) continue;
      const dx = (p % 15) - (last % 15);
      const dy = Math.floor(p / 15) - Math.floor(last / 15);
      cands.push([Math.max(Math.abs(dx), Math.abs(dy)) * 10 + Math.abs(dx) + Math.abs(dy), p]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const before = g.moves.length;
    for (const [, p] of cands.slice(0, 12)) {
      await hit(page, p % 15, Math.floor(p / 15));
      const after = (await game(page)).moves.length;
      if (after > before) break;
    }
  }
  return game(page);
}

test('スマホ縦: 黒で初級と最後まで打って結果が出る', async () => {
  const { page, errors, ctx } = await open({ level: 0, color: 'black', rule: 'free' });
  await page.click('#btnStart');
  // 盤が画面内に収まっている
  const box = await page.locator('#board').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= PHONE.width + 1, '盤が横にはみ出さない');
  assert.ok(box.width > 300, `盤が十分大きい (${box.width})`);
  const g = await playToEnd(page);
  assert.ok(g.result, '勝負がつく');
  await page.waitForSelector('#ovResult.show');
  assert.equal(await page.locator('.stone.win').count() >= 5, true, '五連が強調される');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-result.png` });
  // 勝負がついたあとでも待ったできる
  await page.click('#btnLook');
  await page.click('#btnUndo2');
  await page.waitForTimeout(300);
  const g2 = await game(page);
  assert.equal(g2.result, null);
  assert.ok(g2.moves.length < g.moves.length);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('gomoku.stats.v1')));
  assert.equal(Object.values(st['free.0']).reduce((a, b) => a + b, 0), 0, '待ったで成績も戻る');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('PC: 白番で CPU が先に打ち、待ったは考え中でも効き、再読み込みで続きから', async () => {
  const { page, errors, ctx } = await open({ level: 3, color: 'white', rule: 'free' }, PC);
  await page.click('#btnStart');
  await waitMyTurn(page);
  let g = await game(page);
  assert.equal(g.player, 2);
  assert.equal(g.moves.length, 1, 'CPU（黒）が初手を打つ');
  assert.equal(g.moves[0], 112, '初手は天元');
  await hit(page, 8, 8);
  // 達人が考えている途中で待った
  await page.waitForSelector('#thinking.on');
  await page.click('#btnUndo');
  await page.waitForTimeout(300);
  g = await game(page);
  assert.equal(g.moves.length, 1, '自分の手が取り消される');
  assert.equal(await page.locator('#thinking.on').count(), 0);
  await hit(page, 6, 6);
  await waitMyTurn(page);
  g = await game(page);
  assert.equal(g.moves.length, 3);
  // 棋譜が出る
  assert.equal(await page.locator('#kifu li').count(), 3);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pc-game.png` });
  await page.reload();
  await page.click('#btnResume');
  assert.equal(await page.locator('#stones .stone').count(), 3, '再読み込み後も石が残る');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('連珠: 黒の三三の点に × が出て置けない', async () => {
  const { page, errors, ctx } = await open({ level: 1, color: 'black', rule: 'renju', confirm: 'auto' });
  // 三三ができる局面を保存しておく（黒: (7,5)(7,6)(5,7)(6,7) / 白: 離れた4点）
  await page.evaluate(() => {
    const at = (x, y) => y * 15 + x;
    const moves = [at(7, 5), at(0, 0), at(7, 6), at(14, 0), at(5, 7), at(0, 14), at(6, 7), at(14, 14)];
    localStorage.setItem('gomoku.game.v1', JSON.stringify({ rule: 'renju', level: 1, player: 1, moves, result: null, counted: null }));
  });
  await page.reload();
  await page.click('#btnResume');
  assert.ok(await page.locator('.xmark').count() >= 1, '× が出る');
  await hit(page, 7, 7);
  await page.waitForTimeout(150);
  assert.equal((await game(page)).moves.length, 8, '禁じ手には置けない');
  assert.match(await page.locator('#toast').textContent(), /三三/);
  // スマホでは1回目のタップは仮置き
  await page.tap('#board', { position: await tapPos(page, 9, 9) });
  assert.equal((await game(page)).moves.length, 8);
  assert.equal(await page.locator('#btnPlace:not([hidden])').count(), 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-renju.png` });
  await page.tap('#board', { position: await tapPos(page, 9, 9) });
  await page.waitForTimeout(100);
  assert.equal((await game(page)).moves.length >= 9, true, '2回目のタップで確定');
  assert.deepEqual(errors, []);
  await ctx.close();
});

async function tapPos(page, x, y) {
  const box = await page.locator('#board').boundingBox();
  const T = 14 + 0.9 * 2;
  return { x: ((0.9 + x) / T) * box.width, y: ((0.9 + y) / T) * box.height };
}

test('ルールと設定の画面が開ける', async () => {
  const { page, errors, ctx } = await open({});
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-title.png` });
  await page.click('#btnTitleRules');
  await page.waitForSelector('#ovRules.show');
  await page.click('#ruleTabs [data-tab="renju"]');
  assert.equal(await page.locator('#dgRenju .diagram').count(), 3);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-rules.png` });
  await page.click('#ovRules [data-close]');
  await page.click('#btnStart');
  await page.click('#btnMenu');
  await page.waitForSelector('#ovMenu.show');
  await page.check('#optNumbers');
  assert.equal(await page.locator('#board.numbers').count(), 1);
  assert.deepEqual(errors, []);
  await ctx.close();
});
