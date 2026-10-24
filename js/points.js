/*
 * Hunter Quest — система очков («Аура»).
 * Чистые функции без доступа к состоянию: их легко тестировать (tests/points.test.js)
 * и менять баланс игры в одном месте.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.HQ = root.HQ || {}; root.HQ.points = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  const SPHERES = {
    body:   { key: 'body',   label: 'Тело',  mentor: 'gon' },
    mind:   { key: 'mind',   label: 'Разум', mentor: 'killua' },
    spirit: { key: 'spirit', label: 'Дух',   mentor: 'kurapika' },
  };

  const SIZES = {
    small:  { key: 'small',  label: 'Малое',     xp: 10,  time: '5–10 мин' },
    medium: { key: 'medium', label: 'Среднее',   xp: 25,  time: '20–40 мин' },
    large:  { key: 'large',  label: 'Большое',   xp: 60,  time: '1–3 ч' },
    epic:   { key: 'epic',   label: 'Эпическое', xp: 150, time: 'арка на недели' },
  };

  const DIFFICULTY = {
    easy:   { key: 'easy',   label: 'Спокойный', reward: 1,    penalty: 0.5, desc: 'Штрафы вдвое меньше' },
    normal: { key: 'normal', label: 'Хантер',    reward: 1,    penalty: 1,   desc: 'Сбалансированный режим' },
    hard:   { key: 'hard',   label: 'Хардкор',   reward: 1.25, penalty: 1.5, desc: '+25% к наградам, штрафы ×1.5' },
  };

  const RULES = {
    streakStep: 0.05,          // +5% к наградам за каждый день серии
    streakMaxDays: 10,         // максимум +50%
    missRate: { daily: 0.2, weekly: 0.3 }, // доля от стоимости задания при пропуске
    minMiss: 2,
    relapse: { light: 5, medium: 10, heavy: 20 },
    cleanDay: 3,               // за каждый чистый день по каждой вредной привычке
    cleanMilestones: { 3: 15, 7: 50, 14: 100, 30: 250, 60: 400, 90: 700, 180: 1200, 365: 3000 },
    savingsFull: 200,          // очков за 100% накопления цели (пропорционально)
    savingsMilestones: { 25: 25, 50: 40, 75: 60, 100: 150 },
    savingsRegular: 5,         // бонус, если предыдущий взнос был не позже 8 дней назад
    balanceBonus: 20,          // за день, когда закрыты задания во всех трёх сферах
    allDailiesBonus: 30,       // за все дневные задания
    arcStepXp: 25,             // за шаг эпической арки
    welcomeBonus: 50,          // за прохождение интервью
    planBonus: 10,             // за планёрку (раз в день)
    mainTaskBonus: 15,         // сверху за «главное дело дня»
    levelBase: 50,             // xp для уровня L = levelBase * (L-1)^2
  };

  const RANKS = [
    { min: 1,  title: 'Кандидат в Хантеры' },
    { min: 3,  title: 'Хантер-новичок' },
    { min: 6,  title: 'Лицензированный Хантер' },
    { min: 10, title: 'Хантер ★' },
    { min: 15, title: 'Хантер ★★' },
    { min: 20, title: 'Хантер ★★★' },
    { min: 30, title: 'Мастер Нэн' },
    { min: 40, title: 'Легенда Ассоциации' },
  ];

  // Нэн-тип определяется в конце интервью («гадание на воде») и даёт пассивный бонус.
  const NEN = {
    enhancer:    { key: 'enhancer',    name: 'Усилитель',       bonus: '+10% за задания Тела',              water: 'Воды в стакане становится больше' },
    transmuter:  { key: 'transmuter',  name: 'Преобразователь', bonus: '+10% за задания Разума',            water: 'Вода меняет вкус' },
    emitter:     { key: 'emitter',     name: 'Излучатель',      bonus: '+10% за задания Духа',              water: 'Вода меняет цвет' },
    conjurer:    { key: 'conjurer',    name: 'Материализатор',  bonus: '+15% за эпические арки',            water: 'В воде появляются кристаллы' },
    manipulator: { key: 'manipulator', name: 'Манипулятор',     bonus: '+15% за накопления и чистые дни',   water: 'Листок начинает двигаться' },
    specialist:  { key: 'specialist',  name: 'Специалист',      bonus: '+5% ко всем наградам',              water: 'Происходит что-то совсем иное' },
  };

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function streakMultiplier(days) {
    return 1 + clamp(days || 0, 0, RULES.streakMaxDays) * RULES.streakStep;
  }

  function nenMultiplier(nen, ctx) {
    if (!nen || !ctx) return 1;
    const { sphere, source } = ctx;
    switch (nen) {
      case 'enhancer':    return source === 'task' && sphere === 'body' ? 1.1 : 1;
      case 'transmuter':  return source === 'task' && sphere === 'mind' ? 1.1 : 1;
      case 'emitter':     return source === 'task' && sphere === 'spirit' ? 1.1 : 1;
      case 'conjurer':    return source === 'arc' ? 1.15 : 1;
      case 'manipulator': return source === 'savings' || source === 'habit' ? 1.15 : 1;
      case 'specialist':  return 1.05;
      default: return 1;
    }
  }

  function diff(difficulty) { return DIFFICULTY[difficulty] || DIFFICULTY.normal; }

  function taskReward(task, streakDays, difficulty, nen) {
    return Math.round(task.xp * streakMultiplier(streakDays) * diff(difficulty).reward *
      nenMultiplier(nen, { sphere: task.sphere, source: 'task' }));
  }

  function arcStepReward(difficulty, nen) {
    return Math.round(RULES.arcStepXp * diff(difficulty).reward * nenMultiplier(nen, { source: 'arc' }));
  }

  function arcCompleteReward(difficulty, nen) {
    return Math.round(SIZES.epic.xp * diff(difficulty).reward * nenMultiplier(nen, { source: 'arc' }));
  }

  function missPenalty(task, difficulty) {
    const rate = RULES.missRate[task.kind];
    if (!rate) return 0;
    return Math.max(RULES.minMiss, Math.round(task.xp * rate * diff(difficulty).penalty));
  }

  function relapsePenalty(severity, difficulty) {
    return Math.round((RULES.relapse[severity] || RULES.relapse.medium) * diff(difficulty).penalty);
  }

  // days — сколько чистых дней подряд стало после закрытия дня
  function cleanDayReward(days, nen) {
    if (days <= 0) return { base: 0, bonus: 0 };
    const m = nenMultiplier(nen, { source: 'habit' });
    return {
      base: Math.round(RULES.cleanDay * m),
      bonus: Math.round((RULES.cleanMilestones[days] || 0) * m),
    };
  }

  /*
   * Очки за изменение суммы в копилке. Очки пропорциональны доле цели, а не сумме,
   * поэтому цель «на кроссовки» и цель «на машину» одинаково честны.
   * hit — уже полученные вехи (чтобы не выдавать их повторно после снятия и нового взноса).
   */
  function savingsPoints(prevSaved, newSaved, target, hit, nen) {
    if (!target || target <= 0) return { points: 0, milestones: [] };
    const m = nenMultiplier(nen, { source: 'savings' });
    const capped = (v) => clamp(v, 0, target);
    const delta = capped(newSaved) - capped(prevSaved);
    let points = Math.round(RULES.savingsFull * delta / target * m);
    if (delta > 0 && points === 0) points = 1;
    const milestones = [];
    if (delta > 0) {
      const prevPct = capped(prevSaved) / target * 100;
      const newPct = capped(newSaved) / target * 100;
      for (const key of Object.keys(RULES.savingsMilestones)) {
        const pct = Number(key);
        if (prevPct < pct && newPct >= pct && !(hit && hit[pct])) {
          milestones.push({ pct, bonus: Math.round(RULES.savingsMilestones[pct] * m) });
        }
      }
    }
    return { points, milestones };
  }

  function xpForLevel(level) { return RULES.levelBase * Math.pow(Math.max(1, level) - 1, 2); }
  function levelFromXp(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / RULES.levelBase)) + 1; }

  function levelProgress(xp) {
    const level = levelFromXp(xp);
    const cur = xpForLevel(level);
    const next = xpForLevel(level + 1);
    return { level, cur, next, into: xp - cur, need: next - cur, pct: clamp((xp - cur) / (next - cur), 0, 1) };
  }

  function rankTitle(level) {
    let title = RANKS[0].title;
    for (const r of RANKS) if (level >= r.min) title = r.title;
    return title;
  }

  // Штраф не может опустить ниже порога максимального достигнутого уровня:
  // очки можно потерять, но заработанный ранг — нет.
  function applyWithFloor(current, delta, maxLevel) {
    if (delta >= 0) return current + delta;
    return Math.max(Math.min(current, xpForLevel(maxLevel)), current + delta);
  }

  return {
    SPHERES, SIZES, DIFFICULTY, RULES, RANKS, NEN,
    streakMultiplier, nenMultiplier, taskReward, arcStepReward, arcCompleteReward,
    missPenalty, relapsePenalty, cleanDayReward, savingsPoints,
    xpForLevel, levelFromXp, levelProgress, rankTitle, applyWithFloor,
  };
});
