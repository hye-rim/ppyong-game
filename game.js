'use strict';

// 뿅뿅 블록: 화면·입력·소리. 규칙은 logic.js
const L = LOGIC_PPYONG;
const $ = (id) => document.getElementById(id);
const INK = '#2b1d52';
const W = 360, H = 560;
const COLS = L.COLS, ROWS = L.ROWS, CELL = 45, BX = (W - COLS * CELL) / 2, BY = 134;
const cellX = (i) => BX + (i % COLS) * CELL, cellY = (i) => BY + Math.floor(i / COLS) * CELL;

// ---------- 캔버스 ----------
const canvas = $('game');
const ctx = canvas.getContext('2d');
function fit() {
  const hudH = 52;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - hudH) / H, 1.5);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
}
addEventListener('resize', fit);

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let best = Number(store.get('ppyongBest')) || 0;

// ---------- 소리 ----------
let audio = null;
let muted = store.get('ppyongMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  pop: (n, combo) => { const f = 420 + Math.min(combo, 16) * 26; tone(f, 0.08, 'triangle', 0.08, 220); if (n >= 8) tone(f * 1.5, 0.12, 'sine', 0.06, 300); },
  nope: () => tone(190, 0.08, 'square', 0.04, -50),
  bonus: () => seq([523, 659, 784, 1047, 1319], 60, 'triangle', 0.1),
  bomb: () => { tone(150, 0.25, 'sawtooth', 0.09, -90); tone(600, 0.15, 'triangle', 0.06, 500); },
  bombGet: () => seq([880, 1175], 70, 'triangle', 0.08),
  fever: () => seq([392, 523, 659, 784, 1047], 70, 'square', 0.07),
  shuffle: () => tone(320, 0.18, 'sine', 0.06, 200),
  tick: () => tone(1000, 0.05, 'square', 0.04),
  end: () => seq([523, 392, 330, 262], 120, 'triangle', 0.1),
  medal: () => seq([523, 659, 784, 1047], 90, 'triangle', 0.1),
  go: () => seq([660, 880], 90, 'triangle', 0.09),
};
function toggleMute() { muted = !muted; store.set('ppyongMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
const EMPTY = L.newGame(1);
let st = EMPTY;
let mode = 'title';                    // title | ready | play | paused | over
let readyT = 0, overAt = 0, lastTick = 99, uiT = 0, shake = 0, flash = 0, flashColor = '255,255,255';
let bombMode = false, prevMode = 'play';
let floats = [], particles = [], fallAnim = new Float32Array(L.N), fallT = 1, shakeCell = new Float32Array(L.N), bombFlash = [];
const PALETTE = [['#ff5f7a', '#ffc2cc', '#b0243e'], ['#3fb6ff', '#c7e8ff', '#0b64a8'], ['#4cd964', '#c9f7d2', '#1c8a33'], ['#ffd23f', '#fff4b8', '#b38a00'], ['#b066ff', '#e7ccff', '#6a24b8']];
const btn = { bomb: { x: 14, y: 70, w: 92, h: 38 } };

function updateHud() { $('score').textContent = st.score.toLocaleString('ko-KR'); $('best').textContent = best.toLocaleString('ko-KR'); }
function floatText(x, y, text, color, size = 22) { floats.push({ x, y, text, color, size, t: 0 }); }
function burst(x, y, color, n, sp = 150) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, v = sp * (0.3 + Math.random());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, life: 0.35 + Math.random() * 0.4, t: 0, r: 2 + Math.random() * 3.5, color });
  }
}

function startGame() {
  st = L.newGame((Math.random() * 2 ** 31) | 0);
  mode = 'ready'; readyT = 1.5; lastTick = 99; floats = []; particles = []; bombMode = false; fallAnim.fill(0); bombFlash = [];
  $('overlay').classList.add('hidden');
  updateHud();
}

// ---------- 입력 ----------
function toLocal(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
const cellAt = (x, y) => {
  const c = Math.floor((x - BX) / CELL), r = Math.floor((y - BY) / CELL);
  return c < 0 || c >= COLS || r < 0 || r >= ROWS ? -1 : r * COLS + c;
};
function doTap(i) {
  if (bombMode) {
    const res = L.bomb(st, i);
    if (!res) { sfx.nope(); return; }
    bombMode = false; sfx.bomb(); shake = Math.max(shake, 0.3); flash = 0.3; flashColor = '255,200,100';
    bombFlash = res.cells.concat([i]).map((k) => ({ k, t: 0 }));
    handleEvents(); return;
  }
  const res = L.tap(st, i);
  if (!res) { shakeCell[i] = 0.25; handleEvents(); return; }
  fallAnim = Float32Array.from(st.fall); fallT = 0;
  handleEvents();
}
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (mode !== 'play') return;
  const { x, y } = toLocal(e);
  const b = btn.bomb;
  if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
    if (st.bombs > 0) { bombMode = !bombMode; sfx.tick(); } else sfx.nope();
    return;
  }
  const i = cellAt(x, y);
  if (i >= 0) doTap(i);
});
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { mode === 'paused' ? resume() : pause(); }
  else if (e.code === 'KeyM') toggleMute();
  else if (e.code === 'KeyB' && mode === 'play') { if (st.bombs > 0) bombMode = !bombMode; }
  else if ((e.code === 'Enter' || e.code === 'Space') && mode === 'over' && performance.now() - overAt > 600 && !$('overlay').classList.contains('hidden')) { e.preventDefault(); startGame(); }
});

// ---------- 일시정지 ----------
function pause() {
  if (mode !== 'play' && mode !== 'ready') return;
  prevMode = mode; mode = 'paused';
  $('overlay').innerHTML = `<h2>일시정지</h2><div class="col"><button id="resumeBtn">계속하기</button></div>`;
  $('overlay').classList.remove('hidden');
  $('resumeBtn').onclick = resume;
  $('pauseBtn').textContent = '▶';
}
function resume() {
  if (mode !== 'paused') return;
  mode = prevMode; $('overlay').classList.add('hidden'); $('pauseBtn').textContent = '⏸';
}
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); mode === 'paused' ? resume() : pause(); };
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- 메뉴 ----------
const MEDALS = [null, ['동메달', '#d98a4a'], ['은메달', '#c5ccd6'], ['금메달', '#ffd23f']];
function showTitle() {
  mode = 'title';
  $('overlay').innerHTML = `
    <h1>뿅뿅<br>블록</h1>
    <p>같은 색 블록이 <b>3개 이상</b> 붙어 있으면 눌러서 뿅! (60초)<br>많이 모을수록, 연달아 터뜨릴수록 <b>점수 UP</b></p>
    <p style="font-size:13px">💣 <b>폭탄</b>: 한 줄을 같은 색으로 · ⭐ <b>보너스</b>: 한 색 전부 삭제<br>🔥 <b>슈퍼 피버</b>: 큰 덩어리가 쏟아져요!</p>
    <div class="col"><button id="startBtn">시작하기</button></div>
    <p style="font-size:12px;opacity:.85">PC: 마우스 클릭 · B 폭탄 · P 일시정지 · M 소리</p>`;
  $('overlay').classList.remove('hidden');
  $('startBtn').onclick = (e) => { e.currentTarget.blur(); startGame(); };
}
function showOver() {
  const med = L.gradeOf(st.score);
  const rec = st.score > best;
  if (rec) { best = st.score; store.set('ppyongBest', String(best)); }
  updateHud();
  const m = MEDALS[med];
  $('overlay').innerHTML = `
    <h2>시간 끝!</h2>
    <div class="big">${st.score.toLocaleString('ko-KR')}</div>
    ${rec && st.score > 0 ? '<span class="tag">최고 기록!</span>' : ''}
    ${m ? `<p><span class="tag" style="background:${m[1]};color:${INK}">🏅 ${m[0]}</span></p>` : '<p>8,000점을 넘으면 메달을 받아요</p>'}
    <dl class="stats card2"><dt>터뜨린 블록</dt><dd>${st.removed}개</dd><dt>최고 콤보</dt><dd>${st.maxCombo}</dd><dt>가장 큰 덩어리</dt><dd>${st.bestGroup}개</dd><dt>슈퍼 피버</dt><dd>${st.feverCount}번</dd></dl>
    <p>최고 <b>${best.toLocaleString('ko-KR')}</b></p>
    <div class="col"><button id="againBtn">다시 하기</button></div>`;
  $('overlay').classList.remove('hidden');
  $('againBtn').onclick = (e) => { e.currentTarget.blur(); startGame(); };
  if (med) setTimeout(sfx.medal, 250);
}

// ---------- 이벤트 ----------
function handleEvents() {
  for (const e of st.events) {
    if (e.type === 'pop') {
      const x = cellX(e.i) + CELL / 2, y = cellY(e.i) + CELL / 2;
      sfx.pop(e.n, st.combo);
      burst(x, y, PALETTE[e.color][0], Math.min(14, 4 + e.n));
      floatText(x, y - 10, `+${e.gain}`, e.n >= 8 ? '#ffd23f' : '#fff', e.n >= 8 ? 28 : 22);
      if (e.n >= 10) { shake = Math.max(shake, 0.25); floatText(W / 2, 250, `${e.n}개 뿅!`, '#ff5fa2', 34); }
      for (const k of e.cells) if (k !== e.i && Math.random() < 0.5) burst(cellX(k) + CELL / 2, cellY(k) + CELL / 2, PALETTE[e.color][1], 2, 90);
      updateHud();
    } else if (e.type === 'bonus') {
      sfx.bonus(); shake = 0.5; flash = 0.5; flashColor = '255,236,150';
      floatText(W / 2, 250, `⭐ ${e.n}개 싹쓸이! +${e.gain}`, '#ffd23f', 28);
      for (const k of e.cells) burst(cellX(k) + CELL / 2, cellY(k) + CELL / 2, PALETTE[e.color][0], 3, 180);
      updateHud();
    } else if (e.type === 'fever') {
      sfx.fever(); shake = 0.5; flash = 0.5; flashColor = '255,140,60'; floatText(W / 2, 250, '🔥 슈퍼 피버!', '#ff7a2f', 40);
      fallAnim.fill(0);
    } else if (e.type === 'feverEnd') floatText(W / 2, 250, '피버 끝!', '#fff', 26);
    else if (e.type === 'bomb+') { sfx.bombGet(); floatText(btn.bomb.x + 46, btn.bomb.y + 52, '💣 +1', '#ffd23f', 18); }
    else if (e.type === 'shuffle') { sfx.shuffle(); floatText(W / 2, 250, '섞었어요!', '#fff', 28); }
    else if (e.type === 'nope') sfx.nope();
    else if (e.type === 'end') { sfx.end(); mode = 'over'; overAt = performance.now(); setTimeout(showOver, 700); }
  }
  st.events.length = 0;
}

// ---------- 그리기 ----------
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function drawBackground() {
  const fever = st.fever > 0;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (fever) { const p = 0.5 + 0.5 * Math.sin(uiT * 8); g.addColorStop(0, `hsl(${18 + p * 14},95%,58%)`); g.addColorStop(1, '#c2185b'); }
  else { g.addColorStop(0, '#6b5cff'); g.addColorStop(1, '#8a4fe0'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = -4; i < 14; i++) { ctx.save(); ctx.translate(i * 60, 0); ctx.rotate(-0.5); ctx.fillRect(0, -50, 26, H + 200); ctx.restore(); }
}
function drawBlock(x, y, v, s = 1, dim = false) {
  const m = 3, w = CELL - m * 2;
  ctx.save(); ctx.translate(x + CELL / 2, y + CELL / 2); ctx.scale(s, s); ctx.translate(-CELL / 2, -CELL / 2);
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
  if (v === L.BONUS) {
    const gr = ctx.createLinearGradient(0, 0, CELL, CELL);
    const hue = (uiT * 120) % 360; gr.addColorStop(0, `hsl(${hue},95%,65%)`); gr.addColorStop(0.5, `hsl(${hue + 90},95%,65%)`); gr.addColorStop(1, `hsl(${hue + 200},95%,65%)`);
    ctx.fillStyle = gr; rr(m, m, w, w, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⭐', CELL / 2, CELL / 2 + 2); ctx.textBaseline = 'alphabetic';
  } else {
    const [a, hi, lo] = PALETTE[v];
    ctx.fillStyle = lo; rr(m, m + 3, w, w, 12); ctx.fill();
    ctx.fillStyle = a; rr(m, m, w, w, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = hi; ctx.globalAlpha = 0.7; rr(m + 5, m + 4, w - 18, 7, 4); ctx.fill(); ctx.globalAlpha = 1;
    // 얼굴
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(14, 21, 4.6, 0, 7); ctx.arc(CELL - 14, 21, 4.6, 0, 7); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(15, 22, 2.2, 0, 7); ctx.arc(CELL - 13, 22, 2.2, 0, 7); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(CELL / 2, 28, 5, 0.15, Math.PI - 0.15); ctx.stroke();
  }
  if (dim) { ctx.fillStyle = 'rgba(43,29,82,.45)'; rr(m, m, w, w, 12); ctx.fill(); }
  ctx.restore();
}
function drawBoard(dt) {
  ctx.fillStyle = 'rgba(43,29,82,.35)'; rr(BX - 6, BY - 6, COLS * CELL + 12, ROWS * CELL + 12, 16); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3; rr(BX - 6, BY - 6, COLS * CELL + 12, ROWS * CELL + 12, 16); ctx.stroke();
  ctx.save(); rr(BX - 3, BY - 3, COLS * CELL + 6, ROWS * CELL + 6, 13); ctx.clip();
  fallT = Math.min(1, fallT + dt / 0.28);
  const ease = 1 - Math.pow(1 - fallT, 3);
  for (let i = 0; i < L.N; i++) {
    const v = st.grid[i]; if (v < 0) continue;
    let y = cellY(i) - fallAnim[i] * CELL * (1 - ease);
    let x = cellX(i);
    if (shakeCell[i] > 0) { x += Math.sin(uiT * 60) * 3; shakeCell[i] = Math.max(0, shakeCell[i] - dt); }
    drawBlock(x, y, v, 1, bombMode);
  }
  ctx.restore();
  for (const f of bombFlash) { f.t += dt; const a = Math.max(0, 1 - f.t / 0.5); ctx.fillStyle = `rgba(255,255,255,${a * 0.8})`; rr(cellX(f.k) + 3, cellY(f.k) + 3, CELL - 6, CELL - 6, 12); ctx.fill(); }
  bombFlash = bombFlash.filter((f) => f.t < 0.5);
  if (bombMode) {
    ctx.fillStyle = '#fff'; ctx.font = '15px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
    ctx.strokeText('💣 가운데로 삼을 블록을 눌러요', W / 2, BY + ROWS * CELL / 2); ctx.fillText('💣 가운데로 삼을 블록을 눌러요', W / 2, BY + ROWS * CELL / 2);
  }
}
function drawTop() {
  // 시간 막대
  const frac = Math.max(0, st.timeLeft / L.DURATION), low = st.timeLeft < 10 && mode === 'play';
  ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = INK;
  ctx.fillStyle = '#fff'; rr(14, 12, W - 28, 24, 12); ctx.fill();
  ctx.fillStyle = low ? (Math.floor(uiT * 6) % 2 ? '#ff5f7a' : '#ffa0b0') : '#4cd964';
  if (frac > 0) { rr(14, 12, Math.max(24, (W - 28) * Math.min(1, frac)), 24, 12); ctx.fill(); }
  rr(14, 12, W - 28, 24, 12); ctx.stroke();
  ctx.font = '16px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.fillText(`${Math.ceil(st.timeLeft)}초`, W / 2, 30);
  // 점수
  ctx.font = '36px Jua, sans-serif'; ctx.lineWidth = 7; ctx.strokeStyle = INK; const sc = st.score.toLocaleString('ko-KR');
  ctx.strokeText(sc, W / 2 + 30, 76); ctx.fillStyle = '#fff'; ctx.fillText(sc, W / 2 + 30, 76);
  // 콤보
  if (st.combo >= 2) {
    const txt = `🔥 ${st.combo} 콤보 ×${L.multiplier(st).toFixed(1)}`;
    ctx.font = '16px Jua, sans-serif'; ctx.lineWidth = 5; ctx.strokeText(txt, W / 2 + 30, 98); ctx.fillStyle = '#ffd23f'; ctx.fillText(txt, W / 2 + 30, 98);
    // 콤보 남은 시간
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(W / 2 + 30 - 40, 102, 80 * Math.max(0, st.comboT / L.COMBO_WINDOW), 3);
  }
  // 폭탄 버튼
  const b = btn.bomb, can = st.bombs > 0;
  ctx.fillStyle = INK; rr(b.x, b.y + 4, b.w, b.h, 14); ctx.fill();
  ctx.fillStyle = bombMode ? '#ffd23f' : can ? '#fff' : '#b9b3cf'; rr(b.x, b.y, b.w, b.h, 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = can ? INK : '#7d7699'; ctx.font = '18px Jua, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`💣 ×${st.bombs}${bombMode ? ' ON' : ''}`, b.x + b.w / 2, b.y + 25);
  // 폭탄 진행
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(b.x + 6, b.y + b.h + 9, b.w - 12, 4);
  ctx.fillStyle = '#ffd23f'; ctx.fillRect(b.x + 6, b.y + b.h + 9, (b.w - 12) * (st.bombs >= L.BOMB_MAX ? 1 : st.bombProg / L.BOMB_EVERY), 4);
  // 피버 게이지
  const fv = st.fever > 0;
  ctx.fillStyle = '#fff'; rr(14, 118, W - 28, 10, 5); ctx.fill();
  const gf = fv ? st.fever / L.FEVER_TIME : Math.min(1, st.feverGauge);
  if (gf > 0) { ctx.fillStyle = fv ? '#ff7a2f' : '#ffb347'; rr(14, 118, Math.max(10, (W - 28) * gf), 10, 5); ctx.fill(); }
  ctx.lineWidth = 2.5; rr(14, 118, W - 28, 10, 5); ctx.stroke();
  if (fv) { ctx.font = '13px Jua, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.lineWidth = 4; ctx.strokeText('🔥 SUPER FEVER ×1.5', W - 16, 114); ctx.fillText('🔥 SUPER FEVER ×1.5', W - 16, 114); }
  else { ctx.font = '11px Jua, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.textAlign = 'right'; ctx.fillText('피버', W - 16, 114); }
}
function drawFloats(dt) {
  ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 6; ctx.strokeStyle = INK;
  for (const f of floats) {
    f.t += dt; ctx.globalAlpha = Math.max(0, 1 - f.t / 0.9); const y = f.y - f.t * 46;
    ctx.font = `${f.size}px Jua, sans-serif`; ctx.strokeText(f.text, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
  }
  ctx.globalAlpha = 1; floats = floats.filter((f) => f.t < 0.9);
}
function drawParticles(dt) {
  for (const p of particles) {
    p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt;
    ctx.globalAlpha = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1; particles = particles.filter((p) => p.t < p.life);
}
function drawReady() {
  if (mode !== 'ready') return;
  const n = Math.ceil(readyT / 0.5), txt = readyT > 0.1 ? String(Math.min(3, n)) : '시작!';
  ctx.font = '84px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 12; ctx.strokeStyle = INK;
  ctx.strokeText(txt, W / 2, 340); ctx.fillStyle = '#ffd23f'; ctx.fillText(txt, W / 2, 340);
}
function drawScene(dt) {
  ctx.save();
  if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake * 16, (Math.random() - 0.5) * shake * 16); shake = Math.max(0, shake - dt * 3); }
  drawBackground();
  if (mode === 'ready') { ctx.globalAlpha = 0.35; }
  drawBoard(dt);
  ctx.globalAlpha = 1;
  drawTop(); drawParticles(dt); drawFloats(dt); drawReady();
  if (flash > 0) { ctx.fillStyle = `rgba(${flashColor},${flash})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 2.5); }
  ctx.restore();
}

// ---------- 루프 ----------
let last = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now; uiT += dt;
  if (mode === 'ready') {
    const before = Math.ceil(readyT / 0.5);
    readyT -= dt;
    if (Math.ceil(Math.max(readyT, 0) / 0.5) !== before && readyT > 0.1) sfx.tick();
    if (readyT <= 0) { mode = 'play'; sfx.go(); }
  } else if (mode === 'play') {
    L.step(st, dt);
    const sec = Math.ceil(st.timeLeft);
    if (sec <= 5 && sec > 0 && sec !== lastTick) { lastTick = sec; sfx.tick(); }
    handleEvents();
  }
  drawScene(dt);
  requestAnimationFrame(frame);
}

updateHud();
showTitle();
fit();
requestAnimationFrame(frame);
