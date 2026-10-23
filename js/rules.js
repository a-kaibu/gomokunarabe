// 盤面とルール判定。盤は 15×15 の Int8Array（0=空, 1=黒, 2=白）、座標は y*15+x。
export const N = 15;
export const SIZE = N * N;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const RULES = {
  free: { name: '自由ルール', short: '自由' },
  renju: { name: '連珠ルール', short: '連珠' },
};

export const xy = (p) => [p % N, (p / N) | 0];
export const at = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? y * N + x : -1);
export const other = (c) => 3 - c;

// p を通る d 方向の連続した c の石の数（p 自身も c として数える）
export function runLength(board, p, c, d) {
  const [x, y] = xy(p);
  const [dx, dy] = DIRS[d];
  let n = 1;
  for (let k = 1; ; k++) {
    const q = at(x + dx * k, y + dy * k);
    if (q < 0 || board[q] !== c) break;
    n++;
  }
  for (let k = 1; ; k++) {
    const q = at(x - dx * k, y - dy * k);
    if (q < 0 || board[q] !== c) break;
    n++;
  }
  return n;
}

// 連珠の黒だけは「ちょうど5」で勝ち。それ以外は5以上で勝ち。
const exact = (rule, c) => rule === 'renju' && c === BLACK;

// 石 c が p に置かれている前提で、その石で勝ちになっているか
export function isWinAt(board, p, c, rule) {
  for (let d = 0; d < 4; d++) {
    const n = runLength(board, p, c, d);
    if (exact(rule, c) ? n === 5 : n >= 5) return true;
  }
  return false;
}

// 勝ちになった並び（表示用）。p を通る勝ち筋の座標を端から順に返す。
export function winLine(board, p, c, rule) {
  for (let d = 0; d < 4; d++) {
    const n = runLength(board, p, c, d);
    if (!(exact(rule, c) ? n === 5 : n >= 5)) continue;
    const [x, y] = xy(p);
    const [dx, dy] = DIRS[d];
    let k = 0;
    while (board[at(x - dx * (k + 1), y - dy * (k + 1))] === c && at(x - dx * (k + 1), y - dy * (k + 1)) >= 0) k++;
    const line = [];
    for (let i = 0; i < n; i++) line.push(at(x + dx * (i - k), y + dy * (i - k)));
    return line;
  }
  return null;
}

// 空点 p に c を置いたら勝ちになるか
export function winsBy(board, p, c, rule) {
  if (board[p] !== EMPTY) return false;
  board[p] = c;
  const w = isWinAt(board, p, c, rule);
  board[p] = EMPTY;
  return w;
}

// d 方向の線上で p から ±k の点を列挙
function lineCells(p, d, k) {
  const [x, y] = xy(p);
  const [dx, dy] = DIRS[d];
  const out = [];
  for (let i = -k; i <= k; i++) {
    if (i === 0) continue;
    const q = at(x + dx * i, y + dy * i);
    if (q >= 0) out.push(q);
  }
  return out;
}

// 黒石が p にある前提で、d 方向に p を含む「四」の数（同じ4石からなる達四は1つと数える）
function foursInDir(board, p, d) {
  const keys = new Set();
  for (const q of lineCells(p, d, 4)) {
    if (board[q] !== EMPTY) continue;
    board[q] = BLACK;
    if (runLength(board, p, BLACK, d) === 5) keys.add(stonesKey(board, p, d, q));
    board[q] = EMPTY;
  }
  return keys.size;
}

// p を含む連続した黒の並びのうち q を除いた石の集合を文字列にする
function stonesKey(board, p, d, q) {
  const [x, y] = xy(p);
  const [dx, dy] = DIRS[d];
  let k = 0;
  while (at(x - dx * (k + 1), y - dy * (k + 1)) >= 0 && board[at(x - dx * (k + 1), y - dy * (k + 1))] === BLACK) k++;
  const cells = [];
  for (let i = -k; ; i++) {
    const r = at(x + dx * i, y + dy * i);
    if (r < 0 || board[r] !== BLACK) break;
    if (r !== q) cells.push(r);
  }
  return cells.join(',');
}

// 黒石が p にある前提で、d 方向に p を含む「達四」（両端どちらでも五になる四）があるか
function hasStraightFour(board, p, d) {
  const byKey = new Map();
  for (const q of lineCells(p, d, 4)) {
    if (board[q] !== EMPTY) continue;
    board[q] = BLACK;
    if (runLength(board, p, BLACK, d) === 5) {
      const key = stonesKey(board, p, d, q);
      byKey.set(key, (byKey.get(key) || 0) + 1);
    }
    board[q] = EMPTY;
  }
  for (const n of byKey.values()) if (n >= 2) return true;
  return false;
}

// 黒石が p にある前提で、d 方向に p を含む「三」（次の一手で禁じ手でない達四にできる）があるか
function isThreeInDir(board, p, d, depth) {
  for (const q of lineCells(p, d, 4)) {
    if (board[q] !== EMPTY) continue;
    board[q] = BLACK;
    const straight = hasStraightFour(board, p, d);
    board[q] = EMPTY;
    if (straight && !forbidden(board, q, 'renju', depth + 1)) return true;
  }
  return false;
}

// 連珠ルールで黒が p に打つと禁じ手か。禁じ手なら '三三' '四四' '長連' のどれかを返す。
// 五ができる手は禁じ手より優先される。三は「禁じ手にならずに達四にできる」ものだけを数える。
export function forbidden(board, p, rule, depth = 0) {
  if (rule !== 'renju' || board[p] !== EMPTY || depth > 4) return null;
  board[p] = BLACK;
  try {
    let five = false;
    let over = false;
    for (let d = 0; d < 4; d++) {
      const n = runLength(board, p, BLACK, d);
      if (n === 5) five = true;
      else if (n > 5) over = true;
    }
    if (five) return null;
    if (over) return '長連';
    // 2方向以上で近くに黒石が2つ以上ないと三三・四四にはならない
    let busy = 0;
    for (let d = 0; d < 4; d++) {
      let n = 0;
      for (const q of lineCells(p, d, 4)) if (board[q] === BLACK) n++;
      if (n >= 2) busy++;
    }
    if (busy < 2 && !lineHasDoubleFourChance(board, p)) return null;
    let fours = 0;
    let threes = 0;
    for (let d = 0; d < 4; d++) {
      const f = foursInDir(board, p, d);
      fours += f;
      if (fours >= 2) return '四四';
      if (f === 0 && isThreeInDir(board, p, d, depth)) threes++;
    }
    if (threes >= 2) return '三三';
    return null;
  } finally {
    board[p] = EMPTY;
  }
}

// 一直線上の四四（●●●・●・●●● など）は1方向でも起こるので、黒が4つ以上ある方向も調べる
function lineHasDoubleFourChance(board, p) {
  for (let d = 0; d < 4; d++) {
    let n = 0;
    for (const q of lineCells(p, d, 4)) if (board[q] === BLACK) n++;
    if (n >= 4) return true;
  }
  return false;
}

export function emptyBoard() {
  return new Int8Array(SIZE);
}

export function boardFromMoves(moves) {
  const b = emptyBoard();
  moves.forEach((p, i) => (b[p] = i % 2 === 0 ? BLACK : WHITE));
  return b;
}

// 座標の表記（列 A〜O・行 1〜15、下が 1）
export function coordName(p) {
  const [x, y] = xy(p);
  return 'ABCDEFGHIJKLMNO'[x] + (N - y);
}
