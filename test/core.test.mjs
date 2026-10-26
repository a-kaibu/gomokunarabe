import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoard, at, BLACK, WHITE, EMPTY, forbidden, isWinAt, winLine, winsBy, boardFromMoves, coordName } from '../js/rules.js';
import { chooseMove, Engine } from '../js/ai.js';

// 図から盤を作る。'X'=黒, 'O'=白, '.'=空。図の左上を (ox, oy) に置く。
function board(rows, ox = 3, oy = 3) {
  const b = emptyBoard();
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === 'X') b[at(ox + x, oy + y)] = BLACK;
    if (ch === 'O') b[at(ox + x, oy + y)] = WHITE;
  }));
  return b;
}
const P = (x, y, ox = 3, oy = 3) => at(ox + x, oy + y);

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test('五で勝ち・長連は自由ルールなら勝ち、連珠の黒は勝ちにならない', () => {
  const b = board(['XXXX.']);
  assert.ok(winsBy(b, P(4, 0), BLACK, 'free'));
  assert.ok(winsBy(b, P(4, 0), BLACK, 'renju'));
  const o = board(['XXX.XX']);
  assert.ok(winsBy(o, P(3, 0), BLACK, 'free'));
  assert.ok(!winsBy(o, P(3, 0), BLACK, 'renju'));
  assert.equal(forbidden(o, P(3, 0), 'renju'), '長連');
  const w = board(['OOO.OO']);
  assert.ok(winsBy(w, P(3, 0), WHITE, 'renju'), '白は長連でも勝ち');
});

test('勝ち筋の座標を返す', () => {
  const b = board(['X....', '.X...', '..X..', '...X.', '....X']);
  const line = winLine(b, P(2, 2), BLACK, 'free');
  assert.deepEqual(line, [P(0, 0), P(1, 1), P(2, 2), P(3, 3), P(4, 4)]);
  assert.ok(isWinAt(b, P(4, 4), BLACK, 'free'));
});

test('三三は禁じ手、自由ルールでは打てる', () => {
  // 中央の空点に打つと縦横の三ができる
  const b = board([
    '.....',
    '..X..',
    '..X..',
    'XX...',
    '.....',
  ]);
  assert.equal(forbidden(b, P(2, 3), 'renju'), '三三');
  assert.equal(forbidden(b, P(2, 3), 'free'), null);
});

test('片方が止められた三は三三にならない', () => {
  const b = board([
    '..O..',
    '..X..',
    '..X..',
    'XX...',
    '.....',
  ]);
  // 縦は上が白で止まり、下に伸ばしても達四にならない → 三ではない（ただし下側は空いているので確認）
  const b2 = board([
    '..O..',
    '..X..',
    '..X..',
    'XX...',
    '..O..',
  ]);
  assert.equal(forbidden(b2, P(2, 3), 'renju'), null);
  // 上だけ止めた場合は 下に1つ伸ばしても上が塞がり達四にならないので三ではない
  assert.equal(forbidden(b, P(2, 3), 'renju'), null);
});

test('四四は禁じ手（交差と一直線の両方）', () => {
  const cross = board([
    '..X..',
    '..X..',
    '..X..',
    'XXX..',
    '.....',
  ], 3, 3);
  assert.equal(forbidden(cross, P(2, 4), 'renju'), null, 'ここは縦の五なので勝ち');
  const c2 = board([
    '......',
    '....O.',
    '....X.',
    '....X.',
    '....X.',
    'OXXX..',
  ]);
  assert.equal(forbidden(c2, P(4, 5), 'renju'), '四四');
  const line = board(['X.XXX.X']);
  // ●・●●●・● になる一直線の四四
  const l2 = board(['.X.X.X.X.'], 2, 3);
  assert.equal(forbidden(l2, P(4, 0, 2, 3), 'renju'), '四四');
  assert.equal(forbidden(line, P(1, 0), 'renju'), null, '五ができる手は禁じ手より優先');
});

test('四三は禁じ手ではない', () => {
  const b = board([
    '......',
    '..X...',
    '..X...',
    'XXX...',
    '......',
  ]);
  // (2,4) ではなく (2,3) に既に石がある形: 横 XXX + 縦 XX を作る点
  const b2 = board([
    'O.....',
    '.X....',
    '..X...',
    '......',
    '....X.',
    '..XX..',
  ]);
  // (3,3) に打つと斜めの四 + 縦は X(4,4)… ここでは単に禁じ手でないことを確認
  assert.equal(forbidden(b2, P(3, 3), 'renju'), null);
  assert.equal(forbidden(b, P(2, 4), 'renju'), null);
});

test('座標表記', () => {
  assert.equal(coordName(at(0, 14)), 'A1');
  assert.equal(coordName(at(7, 7)), 'H8');
});

test('CPU は五を打ち、相手の四を止める', () => {
  for (const level of [1, 2, 3]) {
    const b = board(['XOOOO.', '.XXX..']);
    assert.equal(chooseMove(b, WHITE, 'free', level, { rng: seeded(1) }), P(5, 0), `level ${level} は勝つ`);
    const b2 = board(['XOOOO.', '.XXX..', '.X....']);
    assert.equal(chooseMove(b2, BLACK, 'free', level, { rng: seeded(1) }), P(5, 0), `level ${level} は止める`);
  }
});

test('初級は合法手から一様ランダムに打つ', () => {
  const b = board(['XOOOO.', '.XXX..']);
  const seen = new Set();
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const m = chooseMove(b, WHITE, 'free', 0, { rng });
    assert.equal(b[m], EMPTY);
    seen.add(m);
  }
  assert.ok(seen.size > 100, `いろいろな点に打つ (${seen.size})`);
  assert.ok(seen.has(at(14, 14)), '端にも打つ');
});

test('上級以上は四追いを見つける', () => {
  // 黒番。四を連続で打って勝てる形
  const b = board([
    '.......',
    '.XXX.O.',
    '.......',
    '..X....',
    '..X....',
    '.......',
    'O......',
  ]);
  const e = new Engine(b, 'free');
  const first = e.vcf(BLACK, 10);
  assert.ok(first >= 0, 'VCF がある');
  const m = chooseMove(b, BLACK, 'free', 2, { rng: seeded(2) });
  // 打った後も四追いが続く（または勝ち）ことを確認
  b[m] = BLACK;
  const e2 = new Engine(b, 'free');
  assert.ok(e2.fives(BLACK).length >= 1);
});

test('連珠の黒の CPU は禁じ手を打たない', () => {
  const b = board([
    '.....',
    '..X..',
    '..X..',
    'XX...',
    '.....',
  ]);
  // 白もいくつか置いておく
  b[at(0, 0)] = WHITE; b[at(14, 14)] = WHITE; b[at(0, 14)] = WHITE; b[at(14, 0)] = WHITE;
  for (const level of [0, 1, 2, 3]) {
    const m = chooseMove(b, BLACK, 'renju', level, { rng: seeded(level + 3), timeLimit: 500 });
    assert.equal(forbidden(b, m, 'renju'), null, `level ${level}`);
    assert.equal(b[m], EMPTY);
  }
});

test('初手は天元、手順から盤を復元できる', () => {
  assert.equal(chooseMove(emptyBoard(), BLACK, 'free', 2), at(7, 7));
  const b = boardFromMoves([at(7, 7), at(8, 8)]);
  assert.equal(b[at(7, 7)], BLACK);
  assert.equal(b[at(8, 8)], WHITE);
});

test('ルール説明の図の禁じ手は本当に禁じ手になっている', async () => {
  const { RENJU, BASIC } = await import('../js/diagrams.js');
  for (const d of RENJU) {
    const b = emptyBoard();
    let star = -1;
    d.rows.forEach((r, y) => [...r].forEach((ch, x) => {
      const p = at(4 + x, 4 + y);
      if (ch === 'X') b[p] = BLACK;
      if (ch === 'O') b[p] = WHITE;
      if (ch === '*') star = p;
    }));
    assert.equal(forbidden(b, star, 'renju'), d.kind, d.title);
  }
  // 四三の図は禁じ手ではない
  const b = emptyBoard();
  let plus = -1;
  BASIC[2].rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const p = at(4 + x, 4 + y);
    if (ch === 'X') b[p] = BLACK;
    if (ch === 'O') b[p] = WHITE;
    if (ch === '+') plus = p;
  }));
  assert.equal(forbidden(b, plus, 'renju'), null);
});
