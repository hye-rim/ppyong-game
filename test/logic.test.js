'use strict';
// 뿅뿅 블록 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const { COLS, ROWS, N } = L;
const DT = 1 / 60;
// 판 전체를 체크무늬(0·1)로 깔아 덩어리가 없게 만든 뒤 원하는 칸만 바꾼다
function flat(st) { for (let i = 0; i < N; i++) st.grid[i] = ((i % COLS) + ((i / COLS) | 0)) % 2; }
const valid = (st) => [...st.grid].every((v) => v >= 0 && v <= L.PARFAIT);

test('a new game has a full board with something to pop', () => {
  for (let s = 1; s <= 50; s++) {
    for (const mode of ['normal', 'easy']) {
      const st = L.newGame(s, mode);
      assert.ok([...st.grid].every(L.isColor));
      assert.ok(L.hasMove(st));
      assert.strictEqual(st.min, mode === 'easy' ? 2 : 3);
    }
  }
});

test('groups: same colour joined up/down/left/right only', () => {
  const st = L.newGame(1);
  flat(st);
  st.grid[L.idx(0, 0)] = 3; st.grid[L.idx(1, 0)] = 3; st.grid[L.idx(1, 1)] = 3; st.grid[L.idx(2, 2)] = 3;   // (2,2) 는 대각선이라 따로
  assert.strictEqual(L.groupAt(st, L.idx(0, 0)).length, 3);
  assert.strictEqual(L.groupAt(st, L.idx(2, 2)).length, 1);
});

test('tapping: too small a group does nothing and breaks the combo; a group pops, scores and refills', () => {
  const st = L.newGame(2);
  flat(st);
  st.combo = 4;
  assert.strictEqual(L.tap(st, 0), null);
  assert.strictEqual(st.combo, 0);
  for (const c of [0, 1, 2, 3]) st.grid[L.idx(c, ROWS - 1)] = 4;
  const res = L.tap(st, L.idx(0, ROWS - 1));
  assert.strictEqual(res.cells.length, 4);
  assert.strictEqual(res.gain, L.groupScore(4));
  assert.strictEqual(st.score, res.gain);
  assert.strictEqual(st.combo, 1);
  assert.ok(valid(st) && L.hasMove(st));
  const easy = L.newGame(2, 'easy');
  flat(easy);
  easy.grid[0] = 4; easy.grid[1] = 4;
  assert.ok(L.tap(easy, 0), 'two blocks pop in easy mode');
});

test('bigger groups score more than the same blocks in small groups', () => {
  assert.ok(L.groupScore(9) > L.groupScore(3) * 3);
  assert.strictEqual(L.groupScore(3), 24);
});

test('the bomb paints a row and a column, and is limited', () => {
  const st = L.newGame(3);
  flat(st);
  st.bombs = 1;
  const i = L.idx(3, 4);
  st.grid[i] = 2;
  st.grid[L.idx(0, 4)] = L.ROCK;
  const res = L.bomb(st, i);
  for (let c = 0; c < COLS; c++) if (c !== 0) assert.strictEqual(st.grid[L.idx(c, 4)], 2);
  for (let r = 0; r < ROWS; r++) assert.strictEqual(st.grid[L.idx(3, r)], 2);
  assert.strictEqual(st.grid[L.idx(0, 4)], L.ROCK, 'rocks stay rocks');
  assert.strictEqual(res.cells.length, (COLS - 2) + (ROWS - 1));   // 가로줄(누른 칸·돌 빼고) + 세로줄(누른 칸 빼고)
  assert.strictEqual(L.bomb(st, i), null, 'no bombs left');
});

test('a bomb is earned every 25 popped blocks, at most 3', () => {
  const st = L.newGame(4, 'easy');
  st.bombs = 0;
  let popped = 0;
  for (let k = 0; k < 400 && popped < 25 * 6; k++) {
    const i = [...Array(N).keys()].find((j) => L.isColor(st.grid[j]) && L.groupAt(st, j).length >= st.min);
    if (i === undefined) break;
    popped += L.tap(st, i).cells.length;
    assert.ok(st.bombs <= L.BOMB_MAX);
  }
  assert.strictEqual(st.bombs, L.BOMB_MAX);
});

test('items: star clears the commonest colour, hotdog a row, parfait rocks and lone blocks', () => {
  let st = L.newGame(5);
  flat(st);
  st.grid[10] = L.BONUS;
  const count0 = [...st.grid].filter((v) => v === 0).length, count1 = [...st.grid].filter((v) => v === 1).length;
  let res = L.tap(st, 10);
  assert.strictEqual(res.cells.length, 1 + Math.max(count0, count1));

  st = L.newGame(6);
  flat(st);
  st.grid[L.idx(2, 5)] = L.HOTDOG; st.grid[L.idx(4, 5)] = L.ROCK; st.grid[L.idx(4, 4)] = L.ROCK;
  res = L.tap(st, L.idx(2, 5));
  assert.strictEqual(res.cells.length, COLS + 1, 'the row plus the rock touching it');
  assert.ok(valid(st));

  st = L.newGame(7);
  flat(st);                                            // 체크무늬라 모든 블록이 혼자다
  st.grid[0] = L.PARFAIT; st.grid[20] = L.ROCK;
  res = L.tap(st, 0);
  assert.strictEqual(res.cells.length, N);
  assert.deepStrictEqual(res.rocks, [20]);
});

test('rocks next to a popped group break with it', () => {
  const st = L.newGame(8);
  flat(st);
  for (const c of [0, 1, 2]) st.grid[L.idx(c, ROWS - 1)] = 4;
  st.grid[L.idx(3, ROWS - 1)] = L.ROCK;
  st.grid[L.idx(0, ROWS - 2)] = L.ROCK;
  st.grid[L.idx(6, 0)] = L.ROCK;                          // 멀리 있는 돌은 그대로
  const res = L.tap(st, L.idx(0, ROWS - 1));
  assert.strictEqual(res.rocks.length, 2);
  assert.ok([...st.grid].includes(L.ROCK));
});

// 60초 동안 0.25초마다 가장 큰 덩어리(또는 아이템)를 누르는 자동 플레이
function autoplay(seed, mode) {
  const st = L.newGame(seed, mode);
  let since = 0, lastScore = 0, fevers = 0;
  while (!st.over) {
    L.step(st, DT); since += DT;
    if (since < 0.25) continue;
    since = 0;
    let best = -1, size = 0;
    for (let i = 0; i < N; i++) {
      if (L.isItem(st.grid[i])) { best = i; break; }
      const n = L.isColor(st.grid[i]) ? L.groupAt(st, i).length : 0;
      if (n >= st.min && n > size) { size = n; best = i; }
    }
    assert.ok(best >= 0, 'there is always something to tap');
    const before = st.feverCount;
    assert.ok(L.tap(st, best));
    if (st.feverCount > before) fevers++;
    assert.ok(valid(st), 'no holes or junk on the board');
    assert.ok([...st.grid].filter((v) => v === L.ROCK).length <= L.ROCK_MAX);
    if (st.t < 10) assert.ok(![...st.grid].includes(L.ROCK), 'no rocks in the first 10 seconds');
    assert.ok(st.score >= lastScore);
    lastScore = st.score;
    assert.ok(L.hasMove(st));
  }
  return { st, fevers };
}

test('a full game keeps the board sound, and good play reaches fever and a medal', () => {
  for (const mode of ['normal', 'easy']) {
    for (let seed = 1; seed <= 6; seed++) {
      const { st, fevers } = autoplay(seed, mode);
      assert.ok(fevers >= 1, `${mode} seed ${seed}: fever`);
      assert.ok(L.gradeOf(st.score, mode) >= 1, `${mode} seed ${seed}: ${st.score}`);
    }
  }
});
