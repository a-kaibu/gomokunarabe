// CPU の思考。盤上の「5マスの窓」すべてについて黒白の石数を差分更新しながら、
// 候補手の評価・αβ探索・四追い（VCF）探索を行う。ブラウザでは Web Worker の中で動く。
import { N, SIZE, EMPTY, BLACK, WHITE, DIRS, at, xy, other, forbidden, winsBy } from './rules.js';

export const LEVELS = [
  { id: 0, name: '初級', desc: 'のんびり打つ', stars: 1 },
  { id: 1, name: '中級', desc: '攻めも守りも素直', stars: 2 },
  { id: 2, name: '上級', desc: '数手先を読む', stars: 3 },
  { id: 3, name: '達人', desc: '四追いまで読み切る', stars: 4 },
];

// ---- 5マスの窓 ----
const WINDOWS = [];
const CELL_WINDOWS = Array.from({ length: SIZE }, () => []);
for (const [dx, dy] of DIRS) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cells = [];
      for (let k = 0; k < 5; k++) cells.push(at(x + dx * k, y + dy * k));
      if (cells.includes(-1)) continue;
      const w = WINDOWS.length;
      WINDOWS.push(cells);
      for (const c of cells) CELL_WINDOWS[c].push(w);
    }
  }
}
const NW = WINDOWS.length;

// 候補手の評価に使う窓の点数（自分の石だけの窓・相手の石だけの窓）
const ATTACK = [7, 35, 800, 15000, 800000];
const DEFEND = [7, 15, 400, 1800, 100000];
// 局面評価で使う窓の価値
const VALUE = [0, 1, 10, 100, 1000, 0];

const WIN = 1e9;

// 置換表用の乱数（固定シードで生成）
const ZOB = (() => {
  let s = 0x9e3779b9;
  const r = () => ((s = (s ^ (s << 13)) >>> 0), (s = (s ^ (s >>> 17)) >>> 0), (s = (s ^ (s << 5)) >>> 0), s);
  const t = [];
  for (let i = 0; i < SIZE * 3; i++) t.push([r(), r() & 0x1fffff]);
  return t;
})();

class Timeout extends Error {}

export class Engine {
  constructor(board, rule) {
    this.rule = rule;
    this.board = new Int8Array(SIZE);
    this.cnt = [null, new Uint8Array(NW), new Uint8Array(NW)];
    this.near = new Uint8Array(SIZE);
    this.sum = [0, 0, 0];
    this.h1 = 0;
    this.h2 = 0;
    this.stones = 0;
    this.tt = new Map();
    this.nodes = 0;
    this.deadline = Infinity;
    this.vcfFail = new Set();
    for (let p = 0; p < SIZE; p++) if (board[p]) this.place(p, board[p]);
  }

  place(p, c) {
    const o = other(c);
    for (const w of CELL_WINDOWS[p]) {
      const mine = this.cnt[c][w];
      const theirs = this.cnt[o][w];
      if (theirs === 0) this.sum[c] += VALUE[mine + 1] - VALUE[mine];
      else if (mine === 0) this.sum[o] -= VALUE[theirs];
      this.cnt[c][w] = mine + 1;
    }
    this.board[p] = c;
    this.h1 ^= ZOB[p * 3 + c][0];
    this.h2 ^= ZOB[p * 3 + c][1];
    this.stones++;
    this.touch(p, 1);
  }

  remove(p) {
    const c = this.board[p];
    const o = other(c);
    for (const w of CELL_WINDOWS[p]) {
      const mine = this.cnt[c][w] - 1;
      const theirs = this.cnt[o][w];
      this.cnt[c][w] = mine;
      if (theirs === 0) this.sum[c] -= VALUE[mine + 1] - VALUE[mine];
      else if (mine === 0) this.sum[o] += VALUE[theirs];
    }
    this.board[p] = EMPTY;
    this.h1 ^= ZOB[p * 3 + c][0];
    this.h2 ^= ZOB[p * 3 + c][1];
    this.stones--;
    this.touch(p, -1);
  }

  // 周囲2マス以内に石がある空点だけを候補にするための近傍カウント
  touch(p, v) {
    const [x, y] = xy(p);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const q = at(x + dx, y + dy);
        if (q >= 0) this.near[q] += v;
      }
    }
  }

  key() {
    return this.h1 * 0x200000 + this.h2;
  }

  // c が p に打つことが許されるか（連珠の黒の禁じ手）
  legal(p, c) {
    return !(this.rule === 'renju' && c === BLACK && forbidden(this.board, p, 'renju'));
  }

  // c が次の一手で五にできる点
  fives(c) {
    const o = other(c);
    const out = [];
    for (let w = 0; w < NW; w++) {
      if (this.cnt[c][w] !== 4 || this.cnt[o][w] !== 0) continue;
      for (const q of WINDOWS[w]) {
        if (this.board[q] === EMPTY && !out.includes(q) && winsBy(this.board, q, c, this.rule)) out.push(q);
      }
    }
    return out;
  }

  // c が p に打ったときの攻め＋守りの値
  pointScore(p, c) {
    const o = other(c);
    let s = 0;
    for (const w of CELL_WINDOWS[p]) {
      const mine = this.cnt[c][w];
      const theirs = this.cnt[o][w];
      if (theirs === 0) s += ATTACK[mine];
      else if (mine === 0) s += DEFEND[theirs];
    }
    return s;
  }

  // 評価の高い順に候補手を並べる（禁じ手は除く）
  candidates(c, limit) {
    const list = [];
    for (let p = 0; p < SIZE; p++) {
      if (this.board[p] === EMPTY && this.near[p] > 0) list.push([p, this.pointScore(p, c)]);
    }
    list.sort((a, b) => b[1] - a[1]);
    const out = [];
    for (const [p, s] of list) {
      if (!this.legal(p, c)) continue;
      out.push({ p, s });
      if (out.length >= limit) break;
    }
    return out;
  }

  evaluate(c) {
    return this.sum[c] * 1.15 - this.sum[other(c)];
  }

  tick() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) throw new Timeout();
  }

  // ---- αβ探索（ネガマックス） ----
  search(c, depth, alpha, beta, ply, width) {
    this.tick();
    const o = other(c);
    if (this.fives(c).length) return WIN - ply;
    const threats = this.fives(o);
    let moves;
    if (threats.length) {
      // 相手の五を止めるしかない
      moves = threats.filter((p) => this.legal(p, c));
      if (!moves.length) return -(WIN - ply - 1);
      if (threats.length > 1) return -(WIN - ply - 2);
    } else {
      if (depth <= 0) return this.evaluate(c);
      const key = this.key() * 2 + c;
      const hit = this.tt.get(key);
      if (hit && hit.depth >= depth) {
        if (hit.flag === 0) return hit.v;
        if (hit.flag === 1 && hit.v >= beta) return hit.v;
        if (hit.flag === -1 && hit.v <= alpha) return hit.v;
      }
      moves = this.candidates(c, width).map((m) => m.p);
      if (hit && hit.best >= 0) {
        const i = moves.indexOf(hit.best);
        if (i > 0) moves.unshift(...moves.splice(i, 1));
      }
      if (!moves.length) return 0;
      const a0 = alpha;
      let best = -Infinity;
      let bestMove = -1;
      for (const p of moves) {
        this.place(p, c);
        let v;
        try {
          v = -this.search(o, depth - 1, -beta, -alpha, ply + 1, width);
        } finally {
          this.remove(p);
        }
        if (v > best) {
          best = v;
          bestMove = p;
        }
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      this.tt.set(key, { depth, v: best, flag: best <= a0 ? -1 : best >= beta ? 1 : 0, best: bestMove });
      return best;
    }
    // 受けの一手は深さを減らさずに読む（延長は手数で打ち切る）
    let best = -Infinity;
    for (const p of moves) {
      this.place(p, c);
      let v;
      try {
        v = -this.search(o, ply > 24 ? 0 : depth, -beta, -alpha, ply + 1, width);
      } finally {
        this.remove(p);
      }
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // ---- 四追い（VCF）：四を打ち続けて勝てる手順があれば最初の一手を返す ----
  vcf(c, depth) {
    const o = other(c);
    const mine = this.fives(c);
    if (mine.length) return mine[0];
    if (this.fives(o).length || depth <= 0) return -1;
    const key = this.key() * 2 + c;
    if (this.vcfFail.has(key)) return -1;
    this.tick();
    const tried = new Set();
    for (let w = 0; w < NW; w++) {
      if (this.cnt[c][w] !== 3 || this.cnt[o][w] !== 0) continue;
      for (const p of WINDOWS[w]) {
        if (this.board[p] !== EMPTY || tried.has(p)) continue;
        tried.add(p);
        if (!this.legal(p, c)) continue;
        this.place(p, c);
        let win = false;
        try {
          const t = this.fives(c);
          if (t.length >= 2) win = true;
          else if (t.length === 1) {
            const b = t[0];
            // 連珠で黒が止める点が禁じ手なら止められない
            if (!this.legal(b, o)) win = true;
            else {
              this.place(b, o);
              try {
                const counter = this.fives(o);
                if (!counter.length) win = this.vcf(c, depth - 1) >= 0;
                else if (counter.length === 1 && this.legal(counter[0], c)) {
                  // 相手の受けが四になったら、こちらはそれを止めつつ四にできる場合だけ続く
                  const q = counter[0];
                  this.place(q, c);
                  try {
                    const t2 = this.fives(c);
                    if (t2.length >= 2) win = true;
                    else if (t2.length === 1 && !this.fives(o).length) {
                      const b2 = t2[0];
                      if (!this.legal(b2, o)) win = true;
                      else {
                        this.place(b2, o);
                        try {
                          win = !this.fives(o).length && this.vcf(c, depth - 2) >= 0;
                        } finally {
                          this.remove(b2);
                        }
                      }
                    }
                  } finally {
                    this.remove(q);
                  }
                }
              } finally {
                this.remove(b);
              }
            }
          }
        } finally {
          this.remove(p);
        }
        if (win) return p;
      }
    }
    this.vcfFail.add(key);
    return -1;
  }
}

// ---- 一手を選ぶ ----
// board: 現在の盤、c: CPU の色、opts.rng: 0〜1 の乱数関数
export function chooseMove(board, c, rule, level, opts = {}) {
  const rng = opts.rng || Math.random;
  const e = new Engine(board, rule);
  const o = other(c);
  if (e.stones === 0) return at(7, 7);
  if (e.stones === 1) {
    // 2手目は相手の石に接して打つ
    const p0 = board.findIndex((v) => v !== EMPTY);
    const [x, y] = xy(p0);
    const opts2 = [];
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const q = at(x + dx, y + dy);
      const [qx, qy] = xy(q);
      if (q >= 0) opts2.push({ q, d: Math.abs(qx - 7) + Math.abs(qy - 7) });
    }
    opts2.sort((a, b) => a.d - b.d);
    const near = opts2.filter((m) => m.d <= opts2[0].d + 1);
    return near[Math.floor(rng() * near.length)].q;
  }

  // 自分の五は必ず打つ。相手の五は（初級でもほぼ）止める
  const mine = e.fives(c);
  if (mine.length) return mine[0];
  const threats = e.fives(o).filter((p) => e.legal(p, c));
  if (threats.length && (level > 0 || rng() < 0.85)) return threats[0];

  if (level === 0) return pickNoisy(e, c, rng, 6, 0.55);
  if (level === 1) return pickNoisy(e, c, rng, 3, 0.9);

  const deep = level === 3;
  e.deadline = Date.now() + (opts.timeLimit ?? (deep ? 1800 : 1000));
  // 自分の四追いを探す
  try {
    const win = e.vcf(c, deep ? 18 : 8);
    if (win >= 0) return win;
  } catch (err) {
    if (!(err instanceof Timeout)) throw err;
  }
  e.deadline = Date.now() + (opts.timeLimit ?? (deep ? 1800 : 1000));

  // 反復深化で探索。時間切れなら最後に読み切った深さの結果を使う
  const width = deep ? 12 : 9;
  const maxDepth = deep ? 10 : 6;
  let roots = e.candidates(c, deep ? 16 : 12).map((m) => ({ p: m.p, v: 0 }));
  if (threats.length) roots = threats.map((p) => ({ p, v: 0 }));
  if (!roots.length) return firstEmpty(board);
  let ranked = roots;
  for (let depth = 2; depth <= maxDepth; depth += 2) {
    try {
      const res = [];
      let alpha = -Infinity;
      for (const r of ranked) {
        e.place(r.p, c);
        let v;
        try {
          v = -e.search(o, depth - 1, -Infinity, -alpha + 1, 1, width);
        } finally {
          e.remove(r.p);
        }
        res.push({ p: r.p, v });
        if (v > alpha) alpha = v;
      }
      res.sort((a, b) => b.v - a.v);
      ranked = res;
      if (opts.onDepth) opts.onDepth(depth);
      if (ranked[0].v >= WIN - 100 || ranked[0].v <= -(WIN - 100)) break;
    } catch (err) {
      if (!(err instanceof Timeout)) throw err;
      break;
    }
  }

  // 達人は相手の四追いが残る手を避ける
  if (deep) {
    e.deadline = Date.now() + 1500;
    for (const r of ranked.slice(0, 6)) {
      e.place(r.p, c);
      let bad = false;
      try {
        e.vcfFail.clear();
        bad = e.vcf(o, 12) >= 0;
      } catch (err) {
        if (!(err instanceof Timeout)) throw err;
      } finally {
        e.remove(r.p);
      }
      if (!bad) return r.p;
    }
  }
  return ranked[0].p;
}

// 評価上位から少しばらつかせて選ぶ
function pickNoisy(e, c, rng, top, keep) {
  const cands = e.candidates(c, top);
  if (!cands.length) return firstEmpty(e.board);
  for (const m of cands) if (rng() < keep) return m.p;
  return cands[cands.length - 1].p;
}

function firstEmpty(board) {
  // 中央に近い空点
  let best = -1;
  let bd = Infinity;
  for (let p = 0; p < SIZE; p++) {
    if (board[p] !== EMPTY) continue;
    const [x, y] = xy(p);
    const d = Math.abs(x - 7) + Math.abs(y - 7);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

export { WHITE, BLACK };
