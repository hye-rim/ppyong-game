'use strict';

// 뿅뿅 블록: 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 7×9 판에 5가지 색 블록. 같은 색이 상하좌우로 3개 이상 붙어 있으면 눌러서 없앤다. 없앤 자리는 위에서 채워진다
// - 많이 모아서 터뜨릴수록 점수가 크고, 연달아 터뜨리면 콤보 배수가 붙는다 (콤보는 1.6초 안에 이어야 한다)
// - 💣 폭탄: 터뜨린 블록 25개마다 하나 (최대 3개). 고른 블록의 가로·세로 한 줄을 그 블록의 색으로 바꾼다 → 큰 덩어리를 만든다
// - ⭐ 보너스 블록: 가끔 나온다. 누르면 판에서 가장 많은 색을 모두 없앤다
// - 🌭 핫도그: 누르면 그 가로 한 줄을 모두 없앤다 · 🍵 녹차파르페: 누르면 판의 방해 블록과 혼자 떨어진 블록을 모두 없앤다
// - 🪨 방해 블록(돌): 10초부터 가끔 나온다. 눌러도 안 터지고, 옆의 덩어리를 터뜨릴 때 같이 깨진다 (판에 최대 5개)
// - 쉬운 모드는 2개 이상, 보통 모드는 3개 이상 붙어 있으면 터진다
// - 🔥 슈퍼 피버: 점수 게이지가 차면 7초 동안 블록이 좌우에 큼직한 덩어리로 나오고 점수가 1.5배
// - 60초 제한. 터뜨릴 덩어리가 하나도 없으면 판을 자동으로 섞는다
const LOGIC_PPYONG = (() => {
const COLS = 7, ROWS = 9, N = COLS * ROWS, COLORS = 5, BONUS = 5, ROCK = 6, HOTDOG = 7, PARFAIT = 8;
const ROCK_FROM = 10, ROCK_MAX = 5, ROCK_P = 0.05, ROCK_SCORE = 20;
const DURATION = 60, COMBO_WINDOW = 1.6;
const BOMB_EVERY = 25, BOMB_MAX = 3;
const FEVER_NEED = 5000, FEVER_TIME = 7;

function rng(seed) {                                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame(seed = (Math.random() * 2 ** 31) | 0, mode = 'normal') {
  const st = {
    seed, mode, min: mode === 'easy' ? 2 : 3, rand: rng(seed), grid: new Int8Array(N), t: 0, timeLeft: DURATION, score: 0, combo: 0, maxCombo: 0, comboT: 0,
    removed: 0, pops: 0, bombs: 1, bombProg: 0, itemIn: 34, feverGauge: 0, fever: 0, feverCount: 0, fa: 0, fb: 1,
    over: false, events: [], fall: new Float32Array(N), shuffles: 0, bestGroup: 0,
  };
  for (let i = 0; i < N; i++) st.grid[i] = randomColor(st);
  ensureMove(st);
  return st;
}
const randomColor = (st) => Math.floor(st.rand() * COLORS);
const isColor = (v) => v >= 0 && v < COLORS;
const isItem = (v) => v === BONUS || v === HOTDOG || v === PARFAIT;
const countRocks = (st) => { let n = 0; for (let i = 0; i < N; i++) if (st.grid[i] === ROCK) n++; return n; };
const idx = (c, r) => r * COLS + c;

// i 번 칸과 같은 색으로 이어진 덩어리 (돌·아이템은 덩어리가 아니다)
function groupAt(st, i) {
  const col = st.grid[i];
  if (!isColor(col)) return [];
  const seen = new Uint8Array(N), out = [], stack = [i];
  seen[i] = 1;
  while (stack.length) {
    const k = stack.pop(); out.push(k);
    const c = k % COLS, r = (k / COLS) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const j = idx(nc, nr);
      if (!seen[j] && st.grid[j] === col) { seen[j] = 1; stack.push(j); }
    }
  }
  return out;
}
function hasMove(st) {
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (isItem(st.grid[i])) return true;
    if (seen[i]) continue;
    const g = groupAt(st, i);
    for (const k of g) seen[k] = 1;
    if (g.length >= st.min) return true;
  }
  return false;
}
function ensureMove(st) {
  let guard = 0;
  while (!hasMove(st) && guard++ < 50) {
    for (let i = 0; i < N; i++) if (isColor(st.grid[i])) st.grid[i] = randomColor(st);
    st.shuffles++; st.events.push({ type: 'shuffle' });
  }
}

// 피버 중에는 왼쪽·오른쪽이 각각 한 색의 큰 덩어리가 되도록 채운다
function spawnColor(st, c) {
  if (st.fever > 0) {
    if (st.rand() < 0.1) return randomColor(st);
    if (c < 3) return st.fa;
    if (c > 3) return st.fb;
    return st.rand() < 0.5 ? st.fa : st.fb;
  }
  return randomColor(st);
}

// 지운 칸을 아래로 모으고 위에서 채운다. st.fall[i] = 그 칸의 블록이 떨어져 내려온 칸 수 (그리기용)
function refill(st) {
  st.fall.fill(0);
  let itemPlaced = false, rocks = countRocks(st);
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let r = ROWS - 1; r >= 0; r--) { const v = st.grid[idx(c, r)]; if (v >= 0) col.push([v, r]); }   // 아래부터
    const missing = ROWS - col.length;
    for (let k = 0; k < ROWS; k++) {
      const r = ROWS - 1 - k;
      if (k < col.length) { st.grid[idx(c, r)] = col[k][0]; st.fall[idx(c, r)] = r - col[k][1]; }
      else {
        let v = spawnColor(st, c);
        if (st.fever <= 0) {
          if (!itemPlaced && st.itemIn <= 0 && st.rand() < 0.5) {
            const r = st.rand(); v = r < 0.4 ? BONUS : r < 0.7 ? HOTDOG : PARFAIT;
            itemPlaced = true; st.itemIn = 40 + Math.floor(st.rand() * 16);
          } else if (st.t >= ROCK_FROM && rocks < ROCK_MAX && st.rand() < ROCK_P) { v = ROCK; rocks++; }
        }
        st.grid[idx(c, r)] = v; st.fall[idx(c, r)] = missing;   // 새 블록은 위 바깥에서 같이 떨어져 내려온다
      }
    }
  }
}

const multiplier = (st) => (1 + Math.min(st.combo, 20) * 0.05) * (st.fever > 0 ? 1.5 : 1);
const groupScore = (n) => Math.round(8 * n + Math.max(0, n - 3) ** 1.5);

function addScore(st, base) {
  const gain = Math.round(base * multiplier(st));
  st.score += gain;
  if (st.fever <= 0) {
    st.feverGauge += gain / FEVER_NEED;
    if (st.feverGauge >= 1) startFever(st);
  }
  return gain;
}
function startFever(st) {
  st.feverGauge = 0; st.fever = FEVER_TIME; st.feverCount++;
  st.fa = randomColor(st); do { st.fb = randomColor(st); } while (st.fb === st.fa);
  for (let i = 0; i < N; i++) {
    if (isItem(st.grid[i])) st.grid[i] = randomColor(st);
    const c = i % COLS;
    if (st.grid[i] === ROCK) continue;
    if (c !== 3 && st.rand() > 0.1) st.grid[i] = c < 3 ? st.fa : st.fb;
  }
  st.fall.fill(0);
  st.events.push({ type: 'fever' });
}

function afterRemove(st, count) {
  st.removed += count; st.pops++;
  st.itemIn -= count;
  st.bombProg += count;
  while (st.bombProg >= BOMB_EVERY) { st.bombProg -= BOMB_EVERY; if (st.bombs < BOMB_MAX) { st.bombs++; st.events.push({ type: 'bomb+' }); } }
  st.combo++; st.comboT = COMBO_WINDOW; st.maxCombo = Math.max(st.maxCombo, st.combo);
}

// 지울 칸(cells)과 맞닿은 돌은 같이 깨진다
function adjacentRocks(st, cells) {
  const set = new Set(cells), out = new Set();
  for (const k of cells) {
    const c = k % COLS, r = (k / COLS) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const j = idx(nc, nr);
      if (st.grid[j] === ROCK && !set.has(j)) out.add(j);
    }
  }
  return [...out];
}

// 칸들을 실제로 지우고 점수·콤보를 처리한다. base = 칸 점수, 돌은 따로 ROCK_SCORE
function removeCells(st, cells, base, event) {
  const rocks = event.noRocks ? [] : adjacentRocks(st, cells);
  const all = cells.concat(rocks.filter((k) => !cells.includes(k)));
  const gain = addScore(st, base + rocks.length * ROCK_SCORE);
  for (const k of all) st.grid[k] = -1;
  afterRemove(st, all.length);
  refill(st); ensureMove(st);
  delete event.noRocks;
  st.events.push({ ...event, gain, cells: all, rocks });
  return { cells: all, rocks, gain };
}

// 블록을 누른다. 결과: { cells, rocks, gain, ... } 또는 null (덩어리가 아니라서 안 지워짐)
function tap(st, i) {
  if (st.over || i < 0 || i >= N) return null;
  const v = st.grid[i];
  if (v === BONUS) return tapBonus(st, i);
  if (v === HOTDOG) return tapHotdog(st, i);
  if (v === PARFAIT) return tapParfait(st, i);
  const g = groupAt(st, i);
  if (g.length < st.min) { st.combo = 0; st.comboT = 0; st.events.push({ type: 'nope', i }); return null; }
  st.bestGroup = Math.max(st.bestGroup, g.length);
  const res = removeCells(st, g, groupScore(g.length), { type: 'pop', i, n: g.length, color: v });
  res.color = v;
  return res;
}
function tapBonus(st, i) {
  const cnt = new Array(COLORS).fill(0);
  for (let k = 0; k < N; k++) if (isColor(st.grid[k])) cnt[st.grid[k]]++;
  let best = 0; for (let c = 1; c < COLORS; c++) if (cnt[c] > cnt[best]) best = c;
  const cells = [i];
  for (let k = 0; k < N; k++) if (st.grid[k] === best) cells.push(k);
  const res = removeCells(st, cells, 9 * cells.length, { type: 'bonus', i, n: cells.length, color: best });
  res.color = best; res.bonus = true;
  return res;
}
// 🌭 핫도그: 그 가로 한 줄을 모두 없앤다 (줄 안의 돌도 함께)
function tapHotdog(st, i) {
  const r0 = (i / COLS) | 0, cells = [], rocks = [];
  for (let c = 0; c < COLS; c++) { const k = idx(c, r0); if (st.grid[k] === ROCK) rocks.push(k); else cells.push(k); }
  const all = cells.concat(rocks);
  const gain = addScore(st, 9 * cells.length + ROCK_SCORE * rocks.length);
  const side = adjacentRocks(st, all);                      // 줄 위아래에 붙은 돌도 같이 깨진다
  for (const k of all.concat(side)) st.grid[k] = -1;
  afterRemove(st, all.length + side.length);
  refill(st); ensureMove(st);
  st.events.push({ type: 'hotdog', i, n: all.length, gain, cells: all.concat(side), rocks: rocks.concat(side) });
  return { cells: all.concat(side), rocks: rocks.concat(side), gain, item: 'hotdog' };
}
// 🍵 녹차파르페: 판의 모든 돌과 혼자 떨어진 블록(덩어리가 안 되는 블록)을 없앤다
function tapParfait(st, i) {
  const seen = new Uint8Array(N), loners = [], rocks = [];
  for (let k = 0; k < N; k++) {
    if (st.grid[k] === ROCK) { rocks.push(k); continue; }
    if (!isColor(st.grid[k]) || seen[k]) continue;
    const g = groupAt(st, k); for (const x of g) seen[x] = 1;
    if (g.length < st.min) loners.push(...g);
  }
  const cells = [i, ...loners, ...rocks];
  const gain = addScore(st, 10 + 8 * loners.length + ROCK_SCORE * rocks.length);
  for (const k of cells) st.grid[k] = -1;
  afterRemove(st, cells.length);
  refill(st); ensureMove(st);
  st.events.push({ type: 'parfait', i, n: cells.length, gain, cells, rocks, loners });
  return { cells, rocks, loners, gain, item: 'parfait' };
}

// 폭탄: i 번 블록의 가로·세로 한 줄을 그 블록의 색으로 바꾼다 (돌·아이템은 그대로)
function bomb(st, i) {
  if (st.over || st.bombs <= 0 || i < 0 || i >= N) return null;
  const col = st.grid[i];
  if (!isColor(col)) return null;
  st.bombs--;
  const c0 = i % COLS, r0 = (i / COLS) | 0, changed = [];
  for (let c = 0; c < COLS; c++) { const k = idx(c, r0); if (isColor(st.grid[k]) && st.grid[k] !== col) { st.grid[k] = col; changed.push(k); } }
  for (let r = 0; r < ROWS; r++) { const k = idx(c0, r); if (isColor(st.grid[k]) && st.grid[k] !== col) { st.grid[k] = col; changed.push(k); } }
  st.events.push({ type: 'bomb', i, cells: changed });
  return { cells: changed, color: col };
}

function step(st, dt) {
  if (st.over) return;
  st.t += dt; st.timeLeft -= dt;
  if (st.comboT > 0) { st.comboT -= dt; if (st.comboT <= 0) st.combo = 0; }
  if (st.fever > 0) { st.fever -= dt; if (st.fever <= 0) { st.fever = 0; st.events.push({ type: 'feverEnd' }); } }
  if (st.timeLeft <= 0) { st.timeLeft = 0; st.over = true; st.events.push({ type: 'end' }); }
}

const GRADES = { normal: [9000, 18000, 35000], easy: [7500, 14000, 26000] };
const gradeOf = (score, mode = 'normal') => { const g = GRADES[mode] || GRADES.normal; return score >= g[2] ? 3 : score >= g[1] ? 2 : score >= g[0] ? 1 : 0; };   // 0 없음 · 1 동 · 2 은 · 3 금

const LOGIC = { COLS, ROWS, N, COLORS, BONUS, ROCK, HOTDOG, PARFAIT, ROCK_MAX, GRADES, DURATION, COMBO_WINDOW, BOMB_EVERY, BOMB_MAX, FEVER_NEED, FEVER_TIME, isColor, isItem, newGame, groupAt, hasMove, tap, bomb, step, multiplier, groupScore, gradeOf, idx };
return LOGIC;
})();
if (typeof module !== 'undefined') module.exports = LOGIC_PPYONG;
