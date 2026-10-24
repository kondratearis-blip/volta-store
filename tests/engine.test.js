// Запуск: npm test  (node --test, без зависимостей)
const test = require('node:test');
const assert = require('node:assert/strict');

global.self = global;
const P = require('../js/points.js');
global.HQ = { points: P };
require('../js/data/interview.js');
require('../js/data/tasks.js');
require('../js/store.js');
const S = global.HQ.store;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}
let now = new Date(2026, 9, 24, 10);
S.setClock(() => now);
const nextDay = (n = 1) => { now = new Date(now.getTime() + n * 86400000); };

test('уровни: формула и прогресс', () => {
  assert.equal(P.levelFromXp(0), 1);
  assert.equal(P.levelFromXp(49), 1);
  assert.equal(P.levelFromXp(50), 2);
  assert.equal(P.levelFromXp(200), 3);
  assert.equal(P.xpForLevel(10), 4050);
  assert.equal(P.levelProgress(125).pct, 0.5);
});

test('серия увеличивает награду максимум на 50%', () => {
  const task = { xp: 10, sphere: 'mind' };
  assert.equal(P.taskReward(task, 0, 'normal'), 10);
  assert.equal(P.taskReward(task, 4, 'normal'), 12);
  assert.equal(P.taskReward(task, 100, 'normal'), 15);
  assert.equal(P.taskReward({ xp: 100, sphere: 'body' }, 0, 'normal', 'enhancer'), 110);
});

test('штрафы зависят от режима', () => {
  assert.equal(P.missPenalty({ xp: 25, kind: 'daily' }, 'normal'), 5);
  assert.equal(P.missPenalty({ xp: 10, kind: 'daily' }, 'easy'), 2);
  assert.equal(P.missPenalty({ xp: 60, kind: 'weekly' }, 'hard'), 27);
  assert.equal(P.missPenalty({ xp: 60, kind: 'once' }, 'hard'), 0);
  assert.equal(P.relapsePenalty('heavy', 'normal'), 20);
});

test('копилка: очки пропорциональны доле цели, вехи выдаются один раз', () => {
  const r1 = P.savingsPoints(0, 2500, 10000, {});
  assert.equal(r1.points, 50);
  assert.deepEqual(r1.milestones.map((m) => m.pct), [25]);
  const r2 = P.savingsPoints(2500, 12000, 10000, { 25: true });
  assert.equal(r2.points, 150);
  assert.deepEqual(r2.milestones.map((m) => m.pct), [50, 75, 100]);
  assert.equal(P.savingsPoints(5000, 4000, 10000, {}).points, -20);
});

test('штраф не отнимает заработанный уровень', () => {
  assert.equal(P.applyWithFloor(60, -30, 2), 50);
  assert.equal(P.applyWithFloor(60, 10, 2), 70);
});

test('полный цикл: интервью → задания → пропуск → привычки', () => {
  S.init(memoryStorage());
  const answers = {
    name: 'Тест', minutes: 60, difficulty: 'normal', sleep_h: 5, activity: 0, food: 2,
    learn: ['lang'], purpose: 2, bad: ['smoking'], bad_power: 'heavy',
    goal_title: 'Япония', goal_amount: 100000, nen_water: 'enhancer',
  };
  const profile = S.finishInterview(answers);
  const st = S.state;
  assert.equal(profile.name, 'Тест');
  assert.equal(profile.nenType, 'enhancer');
  assert.ok(profile.tags.includes('low_sleep'));
  assert.ok(profile.tags.includes('poor_food'));
  assert.equal(st.xp.total, P.RULES.welcomeBonus);
  assert.equal(st.habits.length, 1);
  assert.equal(st.habits[0].severity, 'heavy');
  assert.equal(st.goals.length, 1);

  const dailies = st.tasks.filter((t) => t.kind === 'daily');
  assert.equal(dailies.length, 4); // 60 минут → 2 малых + 2 средних
  assert.equal(new Set(dailies.slice(0, 3).map((t) => t.sphere)).size, 3, 'первые три задания покрывают все сферы');
  assert.equal(st.tasks.filter((t) => t.kind === 'weekly').length, 2);

  for (const t of dailies) S.completeTask(t.id);
  assert.ok(st.days[S.today()].bonuses.balance);
  assert.ok(st.days[S.today()].bonuses.allDaily);
  assert.equal(st.streak.count, 1);
  const afterDay1 = st.xp.total;

  nextDay();
  S.rollover();
  // за чистый день по курению +3, новые задания на сегодня
  assert.equal(st.xp.total, afterDay1 + 3);
  const today = st.tasks.filter((t) => t.kind === 'daily' && t.created === S.today());
  assert.equal(today.length, 4);

  // Ничего не делаем и пропускаем день → штрафы за 4 задания
  const before = st.xp.total;
  nextDay();
  S.rollover();
  const penalty = today.reduce((a, t) => a + P.missPenalty(t, 'normal'), 0);
  assert.equal(st.xp.total, before - penalty + 3);
  assert.equal(S.effectiveStreak(), 0);

  S.relapse(st.habits[0].id);
  assert.equal(S.cleanDays(st.habits[0]), 0);
  const beforeClose = st.xp.total;
  nextDay();
  S.rollover();
  const missed = st.tasks.filter((t) => t.status === 'missed' && t.due === S.addDays(S.today(), -1));
  const pen2 = missed.reduce((a, t) => a + P.missPenalty(t, 'normal'), 0);
  assert.equal(st.xp.total, Math.max(P.xpForLevel(st.maxLevel.total), beforeClose - pen2), 'в день срыва нет награды за чистый день');
});

test('копилка и арки начисляют очки в сферу Разума/арки', () => {
  S.init(memoryStorage());
  S.finishInterview({ name: 'A', nen_water: 'specialist' });
  S.addGoal({ title: 'Велосипед', target: 1000 });
  const g = S.state.goals[0];
  const mind0 = S.state.xp.mind;
  S.moveMoney(g.id, 500);
  assert.ok(S.state.xp.mind > mind0);
  assert.ok(g.hit[25] && g.hit[50]);
  S.startArc('arc_exam');
  const arc = S.state.arcs[0];
  for (let i = 0; i < arc.steps.length; i++) S.toggleArcStep(arc.id, i);
  assert.equal(arc.status, 'done');
  assert.ok(S.state.achievements.arc_done);
});

test('у каждой сферы и размера есть задания для любого игрока', () => {
  const tags = ['health_limit'];
  for (const s of ['body', 'mind', 'spirit']) for (const z of ['small', 'medium', 'large']) {
    const pool = HQ.data.TEMPLATES.filter((t) => t.sphere === s && t.size === z && S.eligible(t, tags));
    assert.ok(pool.length >= 2, `${s}/${z}`);
  }
});
