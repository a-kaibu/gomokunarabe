// 画面と操作。対局の状態は G（手順の配列）だけを正として、盤は手順から作り直せるようにしている。
import { N, SIZE, EMPTY, BLACK, WHITE, RULES, xy, at, other, isWinAt, winLine, forbidden, boardFromMoves, coordName } from './rules.js';
import { LEVELS } from './ai.js';
import { BASIC, RENJU } from './diagrams.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const M = 0.9; // 盤の端の余白（マス単位）
const T = N - 1 + M * 2;
const KEY = { settings: 'gomoku.settings.v1', game: 'gomoku.game.v1', stats: 'gomoku.stats.v1' };

const load = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

const S = {
  rule: 'free', color: 'black', level: 1, confirm: 'auto',
  numbers: false, coords: false, showForbidden: true, sound: true, volume: 0.7,
  ...load(KEY.settings, {}),
};
const stats = load(KEY.stats, {});
let G = load(KEY.game, null);
if (G && !Array.isArray(G.moves)) G = null;
let B = G ? boardFromMoves(G.moves) : new Int8Array(SIZE);

let worker = null;
let reqId = 0;
let thinking = false;
let pending = -1;
let hover = -1;
let resultTimer = 0;
const els = new Map(); // 点 → 石の要素

const saveSettings = () => save(KEY.settings, S);
const saveGame = () => save(KEY.game, G);
const turnColor = () => (G.moves.length % 2 === 0 ? BLACK : WHITE);
const cpuColor = () => other(G.player);
const myTurn = () => G && !G.result && !thinking && turnColor() === G.player;
const colorName = (c) => (c === BLACK ? '黒' : '白');
const cls = (c) => (c === BLACK ? 'b' : 'w');

audio.setEnabled(S.sound);
audio.setVolume(S.volume);

// ---------- 盤の描画 ----------
function drawGrid() {
  const svg = $('grid');
  svg.setAttribute('viewBox', `0 0 ${T} ${T}`);
  let s = '';
  for (let i = 0; i < N; i++) {
    const v = M + i;
    const edge = i === 0 || i === N - 1 ? ' class="edge"' : '';
    s += `<line x1="${M}" y1="${v}" x2="${M + N - 1}" y2="${v}"${edge}/>`;
    s += `<line x1="${v}" y1="${M}" x2="${v}" y2="${M + N - 1}"${edge}/>`;
  }
  for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) s += `<circle cx="${M + x}" cy="${M + y}" r=".12"/>`;
  s += '<g class="coords">';
  for (let i = 0; i < N; i++) {
    s += `<text x="${M + i}" y="${M - 0.6}">${'ABCDEFGHIJKLMNO'[i]}</text>`;
    s += `<text x="${M - 0.62}" y="${M + i}">${N - i}</text>`;
  }
  s += '</g>';
  svg.innerHTML = s;
  $('winLine').setAttribute('viewBox', `0 0 ${T} ${T}`);
}

function pos(el, p) {
  const [x, y] = xy(p);
  el.style.left = `${((M + x) / T) * 100}%`;
  el.style.top = `${((M + y) / T) * 100}%`;
}

function fit() {
  const wrap = $('boardWrap');
  let w = wrap.clientWidth;
  let h = wrap.clientHeight;
  if (getComputedStyle($('side')).display === 'contents') {
    // スマホの縦並び: 盤以外の高さを引いた残りに収める
    const main = $('main');
    const cs = getComputedStyle(main);
    const rest = ['players', 'status', 'actions'].reduce((a, id) => a + $(id).offsetHeight, 0);
    w = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    h = main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - rest - 8 * 5;
  }
  const size = Math.floor(Math.max(200, Math.min(w, h)));
  const board = $('board');
  board.style.setProperty('--bs', `${size}px`);
  board.style.setProperty('--cell', `${size / T}px`);
}

function stoneEl(p, c, n) {
  const el = document.createElement('div');
  el.className = `stone ${cls(c)}`;
  el.dataset.p = p;
  el.innerHTML = `<span class="num">${n}</span>`;
  pos(el, p);
  return el;
}

function renderStones() {
  const layer = $('stones');
  layer.textContent = '';
  els.clear();
  G.moves.forEach((p, i) => {
    const el = stoneEl(p, i % 2 === 0 ? BLACK : WHITE, i + 1);
    layer.appendChild(el);
    els.set(p, el);
  });
  markLast();
  renderWin(false);
}

function markLast() {
  for (const el of $('stones').querySelectorAll('.last')) el.classList.remove('last');
  const last = G.moves[G.moves.length - 1];
  if (last !== undefined) els.get(last)?.classList.add('last');
}

function renderWin(animate) {
  const svg = $('winLine');
  svg.innerHTML = '';
  for (const el of $('stones').querySelectorAll('.win')) el.classList.remove('win');
  const line = G.result?.line;
  if (!line) return;
  line.forEach((p, i) => {
    const el = els.get(p);
    if (!el) return;
    el.style.setProperty('--i', animate ? i : 0);
    el.classList.add('win');
  });
  const [x1, y1] = xy(line[0]);
  const [x2, y2] = xy(line[line.length - 1]);
  const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  ln.setAttribute('x1', M + x1);
  ln.setAttribute('y1', M + y1);
  ln.setAttribute('x2', M + x2);
  ln.setAttribute('y2', M + y2);
  if (!animate) ln.style.animation = 'none';
  if (!animate) ln.style.strokeDashoffset = '0';
  svg.appendChild(ln);
}

// 黒の禁じ手の点に × を出す（あなたが黒で、連珠ルールで、あなたの番のとき）
function renderMarks() {
  const layer = $('marks');
  layer.textContent = '';
  if (!myTurn() || G.rule !== 'renju' || G.player !== BLACK || !S.showForbidden) return;
  for (let p = 0; p < SIZE; p++) {
    if (B[p] !== EMPTY || !forbidden(B, p, 'renju')) continue;
    const el = document.createElement('div');
    el.className = 'xmark';
    pos(el, p);
    layer.appendChild(el);
  }
}

function renderKifu() {
  const ol = $('kifu');
  ol.innerHTML = G.moves
    .map((p, i) => `<li${i === G.moves.length - 1 ? ' class="cur"' : ''}><b>${i + 1}</b><span class="dot ${i % 2 ? 'w' : 'b'}"></span>${coordName(p)}</li>`)
    .join('');
  ol.scrollTop = ol.scrollHeight;
}

function renderStatus() {
  const you = $('plYou');
  const cpu = $('plCpu');
  you.querySelector('.stone-icon').className = `stone-icon ${cls(G.player)}`;
  cpu.querySelector('.stone-icon').className = `stone-icon ${cls(cpuColor())}`;
  $('youColor').textContent = G.player === BLACK ? '黒・先手' : '白・後手';
  $('cpuLevel').textContent = `${LEVELS[G.level].name}・${colorName(cpuColor())}`;
  $('ruleLabel').textContent = RULES[G.rule].name;
  $('moveCount').textContent = `${G.moves.length}手`;
  const t = turnColor();
  you.classList.toggle('active', !G.result && t === G.player);
  cpu.classList.toggle('active', !G.result && t !== G.player);
  $('thinking').classList.toggle('on', thinking);

  let msg;
  if (G.result) msg = resultText().title;
  else if (thinking) msg = '<span class="muted">CPU が考えています…</span>';
  else if (pending >= 0) msg = `${coordName(pending)} に置きますか？ <span class="muted">もう一度タップで確定</span>`;
  else msg = G.moves.length === 0 ? 'あなたの番です。好きな点に置いてください' : 'あなたの番です';
  $('status').innerHTML = msg;

  const canUndo = G.moves.some((_, i) => (i % 2 === 0 ? BLACK : WHITE) === G.player);
  $('btnUndo').disabled = !canUndo;
  $('btnUndo2').disabled = !canUndo;
  $('btnPlace').hidden = pending < 0;
  $('btnAgain').hidden = !G.result;
  $('btnNew').hidden = !!G.result || pending >= 0;
  $('board').classList.toggle('locked', !myTurn());
  $('board').classList.toggle('numbers', S.numbers);
  $('board').classList.toggle('coords', S.coords);
}

function renderAll() {
  renderStones();
  renderMarks();
  renderKifu();
  renderStatus();
  updateGhost();
}

// ---------- 入力 ----------
function pointAt(e) {
  const r = $('board').getBoundingClientRect();
  const u = ((e.clientX - r.left) / r.width) * T - M;
  const v = ((e.clientY - r.top) / r.height) * T - M;
  const x = Math.round(u);
  const y = Math.round(v);
  if (x < 0 || y < 0 || x >= N || y >= N) return -1;
  if (Math.abs(u - x) > 0.5 || Math.abs(v - y) > 0.5) return -1;
  return at(x, y);
}

function updateGhost() {
  const g = $('ghost');
  const p = pending >= 0 ? pending : hover;
  if (!myTurn() || p < 0 || B[p] !== EMPTY) {
    g.className = '';
    return;
  }
  g.className = `show ${cls(G.player)}${pending >= 0 ? ' pending' : ''}`;
  pos(g, p);
}

function needConfirm(e) {
  if (S.confirm === 'on') return true;
  if (S.confirm === 'off') return false;
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

function onBoardDown(e) {
  audio.unlock();
  if (!myTurn()) return;
  const p = pointAt(e);
  if (p < 0) return;
  if (B[p] !== EMPTY) {
    if (pending >= 0) setPending(-1);
    return;
  }
  const why = G.player === BLACK ? forbidden(B, p, G.rule) : null;
  if (why) {
    audio.play('error');
    toast(`そこは${why}の禁じ手なので置けません`);
    setPending(-1);
    return;
  }
  if (needConfirm(e) && pending !== p) {
    setPending(p);
    audio.play('select');
    return;
  }
  setPending(-1);
  playMove(p);
}

function setPending(p) {
  pending = p;
  updateGhost();
  renderStatus();
}

// ---------- 対局の進行 ----------
function playMove(p) {
  const c = turnColor();
  G.moves.push(p);
  B[p] = c;
  const el = stoneEl(p, c, G.moves.length);
  el.classList.add('drop');
  el.addEventListener('animationend', () => el.classList.remove('drop'), { once: true });
  $('stones').appendChild(el);
  els.set(p, el);
  markLast();
  audio.play(c === G.player ? 'place' : 'cpu');
  hover = -1;

  if (isWinAt(B, p, c, G.rule)) finish({ winner: c, line: winLine(B, p, c, G.rule), reason: 'five' });
  else if (G.moves.length === SIZE) finish({ winner: 0, reason: 'full' });
  saveGame();
  renderMarks();
  renderKifu();
  renderStatus();
  updateGhost();
  if (!G.result && turnColor() === cpuColor()) cpuTurn();
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./cpu-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onCpuMove;
    worker.onerror = (e) => {
      console.error(e);
      toast('CPU の読み込みに失敗しました');
    };
  }
  return worker;
}

let cpuStarted = 0;
function cpuTurn() {
  thinking = true;
  cpuStarted = performance.now();
  const id = ++reqId;
  getWorker().postMessage({ id, board: Array.from(B), color: cpuColor(), rule: G.rule, level: G.level });
  renderStatus();
  updateGhost();
}

function onCpuMove(e) {
  const { id, p } = e.data;
  if (id !== reqId) return;
  // すぐ打ち返すと置かれたことに気づきにくいので、少しだけ間を置く
  const wait = Math.max(0, 380 - (performance.now() - cpuStarted));
  setTimeout(() => {
    if (id !== reqId) return;
    thinking = false;
    if (B[p] !== EMPTY) return;
    playMove(p);
  }, wait);
}

function cancelCpu() {
  reqId++;
  if (thinking && worker) {
    // 読みの途中で止められないので Worker ごと作り直す
    worker.terminate();
    worker = null;
  }
  thinking = false;
}

function statKey() {
  return `${G.rule}.${G.level}`;
}

function finish(result) {
  G.result = result;
  const st = (stats[statKey()] ||= { w: 0, l: 0, d: 0 });
  const k = result.winner === 0 ? 'd' : result.winner === G.player ? 'w' : 'l';
  st[k]++;
  G.counted = k;
  save(KEY.stats, stats);
  renderWin(true);
  audio.play(k === 'w' ? 'win' : k === 'l' ? 'lose' : 'draw', 0.25);
  clearTimeout(resultTimer);
  resultTimer = setTimeout(showResult, result.line ? 900 : 300);
}

function resultText() {
  const r = G.result;
  if (r.winner === 0) return { title: '引き分け', sub: `盤が埋まりました・${G.moves.length}手`, cls: '' };
  const youWin = r.winner === G.player;
  const how = r.reason === 'resign' ? '投了' : `${colorName(r.winner)}の五連`;
  return { title: youWin ? 'あなたの勝ち' : 'CPU の勝ち', sub: `${how}・${G.moves.length}手・${LEVELS[G.level].name}`, cls: youWin ? 'win' : '' };
}

function showResult() {
  if (!G.result) return;
  const t = resultText();
  $('resultTitle').textContent = t.title;
  $('resultTitle').className = `result-title ${t.cls}`;
  $('resultSub').textContent = t.sub;
  open('ovResult');
}

// 待った：自分の直前の手まで戻す。CPU が考え中でも、勝負がついたあとでも使える
function undo() {
  if (!G) return;
  const hasMine = G.moves.some((_, i) => (i % 2 === 0 ? BLACK : WHITE) === G.player);
  if (!hasMine) return;
  cancelCpu();
  clearTimeout(resultTimer);
  close('ovResult');
  if (G.result) {
    const st = stats[statKey()];
    if (st && G.counted && st[G.counted] > 0) st[G.counted]--;
    save(KEY.stats, stats);
    G.result = null;
    G.counted = null;
  }
  const removed = [];
  do removed.push(G.moves.pop());
  while (G.moves.length && turnColor() !== G.player);
  for (const p of removed) B[p] = EMPTY;
  pending = -1;
  saveGame();
  audio.play('undo');
  // 消える石だけ少し浮かせてから描き直す
  for (const p of removed) els.get(p)?.classList.add('lift');
  setTimeout(renderAll, 140);
  renderStatus();
}

function newGame() {
  cancelCpu();
  clearTimeout(resultTimer);
  close('ovResult');
  let player = S.color === 'white' ? WHITE : BLACK;
  if (S.color === 'alt') {
    player = S.altNext === WHITE ? WHITE : BLACK;
    S.altNext = other(player);
    saveSettings();
  }
  G = { rule: S.rule, level: S.level, player, moves: [], result: null, counted: null };
  B = new Int8Array(SIZE);
  pending = -1;
  saveGame();
  renderAll();
  audio.play('start');
  if (turnColor() === cpuColor()) setTimeout(cpuTurn, 350);
}

function resign() {
  if (!G || G.result) return;
  cancelCpu();
  finish({ winner: cpuColor(), reason: 'resign' });
  saveGame();
  renderAll();
}

// ---------- オーバーレイ ----------
function open(id) {
  $(id).classList.add('show');
  if (id !== 'ovResult') audio.play('open');
}
function close(id) {
  $(id).classList.remove('show');
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function segment(id, value, onPick) {
  const seg = $(id);
  for (const b of seg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === String(value));
    b.onclick = () => {
      audio.unlock();
      audio.play('tap');
      for (const x of seg.querySelectorAll('button')) x.classList.toggle('on', x === b);
      onPick(b.dataset.v);
    };
  }
}

const RULE_DESC = {
  free: '禁じ手なし。六つ以上並んでも勝ち。気軽に遊ぶならこちら。',
  renju: '先手の黒だけ 三三・四四・長連 が禁じ手。先手と後手の差が小さくなります。',
};

function renderTitle() {
  $('levelSeg').innerHTML = LEVELS.map(
    (l) => `<button data-v="${l.id}"><span class="stars">${'●'.repeat(l.stars)}${'○'.repeat(4 - l.stars)}</span><b>${l.name}</b><small>${l.desc}</small></button>`,
  ).join('');
  const refresh = () => {
    $('ruleDesc').textContent = RULE_DESC[S.rule];
    const st = stats[`${S.rule}.${S.level}`];
    $('statLine').textContent = st && st.w + st.l + st.d > 0
      ? `${RULES[S.rule].short}・${LEVELS[S.level].name}との成績：${st.w}勝 ${st.l}敗${st.d ? ` ${st.d}分` : ''}`
      : '';
  };
  segment('ruleSeg', S.rule, (v) => ((S.rule = v), saveSettings(), refresh()));
  segment('colorSeg', S.color, (v) => ((S.color = v), saveSettings()));
  segment('levelSeg', S.level, (v) => ((S.level = +v), saveSettings(), refresh()));
  refresh();
  const ongoing = G && !G.result && G.moves.length > 0;
  $('btnResume').hidden = !ongoing;
  $('btnStart').textContent = ongoing ? '新しく対局をはじめる' : '対局をはじめる';
}

function showTitle() {
  renderTitle();
  open('ovTitle');
}

function diagramSvg(rows) {
  const n = rows.length;
  const m = 0.7;
  const t = n - 1 + m * 2;
  let s = `<svg viewBox="0 0 ${t} ${t}">`;
  for (let i = 0; i < n; i++) {
    s += `<line x1="${m}" y1="${m + i}" x2="${m + n - 1}" y2="${m + i}" stroke="#4a3115" stroke-width=".04"/>`;
    s += `<line x1="${m + i}" y1="${m}" x2="${m + i}" y2="${m + n - 1}" stroke="#4a3115" stroke-width=".04"/>`;
  }
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const cx = m + x;
    const cy = m + y;
    if (ch === 'X') s += `<circle cx="${cx}" cy="${cy}" r=".44" fill="#111"/>`;
    if (ch === 'O') s += `<circle cx="${cx}" cy="${cy}" r=".44" fill="#f7f4ec" stroke="#0004" stroke-width=".03"/>`;
    if (ch === '+') s += `<circle cx="${cx}" cy="${cy}" r=".3" fill="none" stroke="#c8242c" stroke-width=".09"/>`;
    if (ch === '*') s += `<path d="M${cx - 0.25} ${cy - 0.25}L${cx + 0.25} ${cy + 0.25}M${cx + 0.25} ${cy - 0.25}L${cx - 0.25} ${cy + 0.25}" stroke="#c8242c" stroke-width=".1" stroke-linecap="round"/>`;
  }));
  return `${s}</svg>`;
}

function renderRules() {
  const fig = (d) => `<figure class="diagram" style="margin:0">${diagramSvg(d.rows)}<b>${d.title}</b><span>${d.text}</span></figure>`;
  $('dgBasic').innerHTML = BASIC.map(fig).join('');
  $('dgRenju').innerHTML = RENJU.map(fig).join('');
  $('levelTerms').innerHTML = LEVELS.map((l) => `<dt>${l.name}</dt><dd>${levelLong[l.id]}</dd>`).join('');
  for (const b of $('ruleTabs').querySelectorAll('button')) {
    b.onclick = () => showRuleTab(b.dataset.tab);
  }
}
const levelLong = [
  '空いている所から完全にランダムに打ちます。勝ちも守りも考えません。',
  '攻めと守りの価値を一手ずつ見て、いちばん良さそうな手を打ちます。',
  '6手先まで読み、四を連続で打つ勝ち筋（四追い）も探します。',
  '時間いっぱい深く読み、相手の四追いが残る手も避けます。',
];

function showRuleTab(tab) {
  for (const b of $('ruleTabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const el of document.querySelectorAll('.tab-body')) el.hidden = el.dataset.tab !== tab;
}

function showRules(tab = 'basic') {
  showRuleTab(tab);
  open('ovRules');
}

function renderMenu() {
  segment('confirmSeg', S.confirm, (v) => ((S.confirm = v), saveSettings(), setPending(-1)));
  const bind = (id, key, after) => {
    const el = $(id);
    el.checked = !!S[key];
    el.onchange = () => {
      S[key] = el.checked;
      saveSettings();
      after?.();
    };
  };
  bind('optNumbers', 'numbers', renderStatus);
  bind('optCoords', 'coords', renderStatus);
  bind('optForbidden', 'showForbidden', renderMarks);
  bind('optSound', 'sound', () => audio.setEnabled(S.sound));
  const vol = $('optVolume');
  vol.value = S.volume;
  vol.oninput = () => {
    S.volume = +vol.value;
    audio.setVolume(S.volume);
    saveSettings();
  };
  vol.onchange = () => audio.play('place');
  $('btnResign').disabled = !G || !!G.result || G.moves.length === 0;
}

// ---------- 起動 ----------
function init() {
  drawGrid();
  renderRules();
  fit();
  new ResizeObserver(fit).observe($('main'));
  if (!G) {
    G = { rule: S.rule, level: S.level, player: BLACK, moves: [], result: null, counted: null };
    B = new Int8Array(SIZE);
  }
  renderAll();
  showTitle();

  const board = $('board');
  board.addEventListener('pointerdown', onBoardDown);
  board.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const p = pointAt(e);
    if (p !== hover) {
      hover = p;
      updateGhost();
    }
  });
  board.addEventListener('pointerleave', () => {
    hover = -1;
    updateGhost();
  });

  $('btnUndo').onclick = undo;
  $('btnUndo2').onclick = undo;
  $('btnPlace').onclick = () => {
    const p = pending;
    setPending(-1);
    if (p >= 0 && myTurn()) playMove(p);
  };
  $('btnAgain').onclick = newGame;
  $('btnAgain2').onclick = newGame;
  $('btnLook').onclick = () => close('ovResult');
  $('btnNew').onclick = showTitle;
  $('btnRules').onclick = () => showRules();
  $('btnTitleRules').onclick = () => showRules();
  $('btnRuleMore').onclick = () => showRules(S.rule === 'renju' ? 'renju' : 'basic');
  $('btnMenu').onclick = () => {
    renderMenu();
    open('ovMenu');
  };
  $('btnResign').onclick = () => {
    close('ovMenu');
    resign();
  };
  $('btnToTitle').onclick = () => {
    close('ovMenu');
    showTitle();
  };
  $('btnStart').onclick = () => {
    audio.unlock();
    close('ovTitle');
    newGame();
  };
  $('btnResume').onclick = () => {
    audio.unlock();
    close('ovTitle');
    resume();
  };
  for (const ov of document.querySelectorAll('.overlay')) {
    ov.addEventListener('pointerdown', (e) => {
      if (e.target === ov && ov.id !== 'ovTitle' && ov.id !== 'ovResult') close(ov.id);
    });
    for (const b of ov.querySelectorAll('[data-close]')) b.onclick = () => close(ov.id);
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      if (pending >= 0) setPending(-1);
      for (const id of ['ovRules', 'ovMenu', 'ovResult']) close(id);
    }
  });
}

// 保存された対局を続ける（CPU の番で止まっていたら考えはじめる）
function resume() {
  renderAll();
  if (G.result) showResult();
  else if (turnColor() === cpuColor()) cpuTurn();
}

// タイトルを閉じずに盤を触れないよう、タイトル表示中は CPU を動かさない
init();
