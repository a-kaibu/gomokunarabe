// CPU 同士を対局させて強さの差を確かめる: node tools/selfplay.mjs 2 1 10 free
import { emptyBoard, BLACK, WHITE, SIZE, isWinAt, forbidden } from '../js/rules.js';
import { chooseMove } from '../js/ai.js';

const [a = 2, b = 1, games = 10, rule = 'free', tl] = process.argv.slice(2);
let s = 12345;
const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const score = { a: 0, b: 0, draw: 0 };
let maxMs = 0;
for (let g = 0; g < +games; g++) {
  const board = emptyBoard();
  const aColor = g % 2 === 0 ? BLACK : WHITE;
  let c = BLACK;
  let result = 'draw';
  for (let n = 0; n < SIZE; n++) {
    const lv = c === aColor ? +a : +b;
    const t0 = Date.now();
    const p = chooseMove(board, c, rule, lv, { rng, timeLimit: tl ? +tl : undefined });
    maxMs = Math.max(maxMs, Date.now() - t0);
    if (board[p] !== 0) throw new Error('occupied ' + p);
    if (c === BLACK && forbidden(board, p, rule)) throw new Error('forbidden move by level ' + lv);
    board[p] = c;
    if (isWinAt(board, p, c, rule)) {
      result = c === aColor ? 'a' : 'b';
      break;
    }
    c = 3 - c;
  }
  score[result]++;
  process.stdout.write(result === 'a' ? 'A' : result === 'b' ? 'b' : '-');
}
console.log(`\nlevel ${a} vs ${b} (${rule}):`, score, 'max think ms', maxMs);
