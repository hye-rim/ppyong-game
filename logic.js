'use strict';

// 뿅뿅 블록: 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 7×9 판에 5가지 색 블록. 같은 색이 상하좌우로 3개 이상 붙어 있으면 눌러서 없앤다. 없앤 자리는 위에서 채워진다
// - 많이 모아서 터뜨릴수록 점수가 크고, 연달아 터뜨리면 콤보 배수가 붙는다 (콤보는 1.6초 안에 이어야 한다)
// - 💣 폭탄: 터뜨린 블록 25개마다 하나 (최대 3개). 고른 블록의 가로·세로 한 줄을 그 블록의 색으로 바꾼다 → 큰 덩어리를 만든다
// - ⭐ 보너스 블록: 가끔 나온다. 누르면 판에서 가장 많은 색을 모두 없앤다
// - 🔥 슈퍼 피버: 점수 게이지가 차면 7초 동안 블록이 좌우에 큼직한 덩어리로 나오고 점수가 1.5배
// - 60초 제한. 터뜨릴 덩어리가 하나도 없으면 판을 자동으로 섞는다
const LOGIC_PPYONG = (() => {
const COLS = 7, ROWS = 9, N = COLS * ROWS, COLORS = 5, BONUS = 5;
const DURATION = 60, COMBO_WINDOW = 1.6;
const BOMB_EVERY = 25, BOMB_MAX = 3;
const FEVER_NEED = 5000, FEVER_TIME = 7;
const MIN_GROUP = 3;

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

function newGame(seed = (Math.random() * 2 ** 31) | 0) {
  const st = {
    seed, rand: rng(seed), grid: new Int8Array(N), t: 0, timeLeft: DURATION, score: 0, combo: 0, maxCombo: 0, comboT: 0,
    removed: 0, pops: 0, bombs: 1, bombProg: 0, bonusIn: 30, feverGauge: 0, fever: 0, feverCount: 0, fa: 0, fb: 1,
    over: false, events: [], fall: new Float32Array(N), shuffles: 0, bestGroup: 0,
  };
  for (let i = 0; i < N; i++) st.grid[i] = randomColor(st);
  ensureMove(st);
  return st;
}
const randomColor = (st) => Math.floor(st.rand() * COLORS);
const idx = (c, r) => r * COLS + c;

// i 번 칸과 같은 색으로 이어진 덩어리 (보너스 블록은 혼자)
function groupAt(st, i) {
  const col = st.grid[i];
  if (col < 0 || col === BONUS) return [];
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
    if (st.grid[i] === BONUS) return true;
    if (seen[i]) continue;
    const g = groupAt(st, i);
    for (const k of g) seen[k] = 1;
    if (g.length >= MIN_GROUP) return true;
  }
  return false;
}
function ensureMove(st) {
  let guard = 0;
  while (!hasMove(st) && guard++ < 50) {
    for (let i = 0; i < N; i++) if (st.grid[i] !== BONUS) st.grid[i] = randomColor(st);
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
  let bonusPlaced = false;
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let r = ROWS - 1; r >= 0; r--) { const v = st.grid[idx(c, r)]; if (v >= 0) col.push([v, r]); }   // 아래부터
    const missing = ROWS - col.length;
    for (let k = 0; k < ROWS; k++) {
      const r = ROWS - 1 - k;
      if (k < col.length) { st.grid[idx(c, r)] = col[k][0]; st.fall[idx(c, r)] = r - col[k][1]; }
      else {
        let v = spawnColor(st, c);
        if (!bonusPlaced && st.bonusIn <= 0 && st.fever <= 0 && st.rand() < 0.5) { v = BONUS; bonusPlaced = true; st.bonusIn = 36 + Math.floor(st.rand() * 14); }
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
    if (st.grid[i] === BONUS) st.grid[i] = randomColor(st);
    const c = i % COLS;
    if (c !== 3 && st.rand() > 0.1) st.grid[i] = c < 3 ? st.fa : st.fb;
  }
  st.fall.fill(0);
  st.events.push({ type: 'fever' });
}

function afterRemove(st, count) {
  st.removed += count; st.pops++;
  st.bonusIn -= count;
  st.bombProg += count;
  while (st.bombProg >= BOMB_EVERY) { st.bombProg -= BOMB_EVERY; if (st.bombs < BOMB_MAX) { st.bombs++; st.events.push({ type: 'bomb+' }); } }
  st.combo++; st.comboT = COMBO_WINDOW; st.maxCombo = Math.max(st.maxCombo, st.combo);
}

// 블록을 누른다. 결과: { cells, gain, bonus } 또는 null (3개 미만이라 안 지워짐)
function tap(st, i) {
  if (st.over || i < 0 || i >= N) return null;
  if (st.grid[i] === BONUS) return tapBonus(st, i);
  const g = groupAt(st, i);
  if (g.length < MIN_GROUP) { st.combo = 0; st.comboT = 0; st.events.push({ type: 'nope', i }); return null; }
  const colors = st.grid[i];
  const gain = addScore(st, groupScore(g.length));
  for (const k of g) st.grid[k] = -1;
  afterRemove(st, g.length);
  st.bestGroup = Math.max(st.bestGroup, g.length);
  refill(st); ensureMove(st);
  st.events.push({ type: 'pop', i, n: g.length, gain, color: colors, cells: g });
  return { cells: g, gain, color: colors };
}
function tapBonus(st, i) {
  const cnt = new Array(COLORS).fill(0);
  for (let k = 0; k < N; k++) if (st.grid[k] >= 0 && st.grid[k] < COLORS) cnt[st.grid[k]]++;
  let best = 0; for (let c = 1; c < COLORS; c++) if (cnt[c] > cnt[best]) best = c;
  const cells = [i];
  for (let k = 0; k < N; k++) if (st.grid[k] === best) cells.push(k);
  const gain = addScore(st, 9 * cells.length);
  for (const k of cells) st.grid[k] = -1;
  afterRemove(st, cells.length);
  refill(st); ensureMove(st);
  st.events.push({ type: 'bonus', i, n: cells.length, gain, color: best, cells });
  return { cells, gain, color: best, bonus: true };
}

// 폭탄: i 번 블록의 가로·세로 한 줄을 그 블록의 색으로 바꾼다
function bomb(st, i) {
  if (st.over || st.bombs <= 0 || i < 0 || i >= N) return null;
  const col = st.grid[i];
  if (col < 0 || col === BONUS) return null;
  st.bombs--;
  const c0 = i % COLS, r0 = (i / COLS) | 0, changed = [];
  for (let c = 0; c < COLS; c++) { const k = idx(c, r0); if (st.grid[k] !== col && st.grid[k] !== BONUS) { st.grid[k] = col; changed.push(k); } }
  for (let r = 0; r < ROWS; r++) { const k = idx(c0, r); if (st.grid[k] !== col && st.grid[k] !== BONUS) { st.grid[k] = col; changed.push(k); } }
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

const gradeOf = (score) => (score >= 30000 ? 3 : score >= 16000 ? 2 : score >= 8000 ? 1 : 0);   // 0 없음 · 1 동 · 2 은 · 3 금

const LOGIC = { COLS, ROWS, N, COLORS, BONUS, DURATION, COMBO_WINDOW, BOMB_EVERY, BOMB_MAX, FEVER_NEED, FEVER_TIME, MIN_GROUP, newGame, groupAt, hasMove, tap, bomb, step, multiplier, groupScore, gradeOf, idx };
return LOGIC;
})();
if (typeof module !== 'undefined') module.exports = LOGIC_PPYONG;
