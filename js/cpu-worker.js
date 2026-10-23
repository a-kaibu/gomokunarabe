// CPU の思考は UI を止めないよう Worker で行う
import { chooseMove } from './ai.js';

self.onmessage = (e) => {
  const { id, board, color, rule, level } = e.data;
  const p = chooseMove(Int8Array.from(board), color, rule, level);
  self.postMessage({ id, p });
};
