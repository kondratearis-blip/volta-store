/*
 * Игровой движок: состояние, сохранение, начисление очков, смена дня, генерация заданий.
 * Работает и в браузере, и в Node (для тестов): хранилище подменяется через HQ.store.init(storage).
 */
(function (root) {
  const HQ = root.HQ = root.HQ || {};
  const P = HQ.points;
  const KEY = 'hunterquest.v1';
  const VERSION = 1;
  const SPH = ['body', 'mind', 'spirit'];

  // ——— Даты (локальные, формат YYYY-MM-DD) ———
  function dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function parseDay(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); }
  function diffDays(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
  let clock = () => new Date();
  const today = () => dayKey(clock());

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function defaultState() {
    return {
      version: VERSION,
      profile: null,               // заполняется после интервью
      xp: { total: 0, body: 0, mind: 0, spirit: 0 },
      maxLevel: { total: 1, body: 1, mind: 1, spirit: 1 },
      streak: { count: 0, last: null, best: 0 },
      tasks: [],
      arcs: [],
      customTemplates: [],
      goals: [],
      habits: [],
      days: {},                    // служебное по дням: done, spheres, bonuses, rerolls, quick
      history: {},                 // статистика по дням для вкладки «Прогресс» (хранится год)
      plans: {},                   // планёрки: что будет в этот день
      settings: { remind: true, planTime: '21:00', morningTime: '08:30' },
      lastDay: null,
      lastWeeklyGen: null,
      stats: { tasksDone: 0, earned: 0, lost: 0, quick: 0, plans: 0 },
      achievements: {},
      log: [],
    };
  }

  let state = defaultState();
  let storage = null;
  const fx = [];                   // эффекты для интерфейса: тосты, уровни, достижения

  function init(customStorage) {
    storage = customStorage || null;
    // В некоторых окнах (встроенные просмотрщики, приватный режим) даже обращение к localStorage бросает ошибку.
    if (!storage) { try { storage = typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { storage = null; } }
    try {
      const raw = storage && storage.getItem(KEY);
      state = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
      state.stats = Object.assign(defaultState().stats, state.stats);
      state.settings = Object.assign(defaultState().settings, state.settings);
    } catch (e) { state = defaultState(); }
    return state;
  }
  const saveListeners = [];
  function save() {
    state.savedAt = Date.now();
    try { storage && storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ }
    for (const fn of saveListeners) fn(state);
  }
  // Подменить всё состояние (например, сохранением из облака). Слушателей не будит.
  function replaceState(data) {
    state = Object.assign(defaultState(), data);
    state.stats = Object.assign(defaultState().stats, state.stats);
    state.settings = Object.assign(defaultState().settings, state.settings);
    try { storage && storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ }
  }
  function reset() { state = defaultState(); save(); }
  function exportJson() { return JSON.stringify(state, null, 2); }
  function importJson(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.xp) throw new Error('Это не файл сохранения Hunter Quest');
    state = Object.assign(defaultState(), data);
    save();
  }

  function dayStat(k = today()) {
    if (!state.days[k]) state.days[k] = { done: 0, spheres: {}, bonuses: {}, rerolls: 0, quick: {} };
    return state.days[k];
  }

  function hist(k = today()) {
    if (!state.history[k]) state.history[k] = { gain: 0, loss: 0, g: { body: 0, mind: 0, spirit: 0, other: 0 }, done: 0, missed: 0, quick: 0, plan: false };
    return state.history[k];
  }

  const difficulty = () => (state.profile && state.profile.difficulty) || 'normal';
  const nen = () => state.profile && state.profile.nenType;

  // ——— Очки ———
  function addPoints(amount, sphere, reason, opts = {}) {
    amount = Math.round(amount);
    if (!amount) return 0;
    const x = state.xp;
    const before = x.total;
    x.total = P.applyWithFloor(x.total, amount, state.maxLevel.total);
    const applied = x.total - before;
    if (sphere && SPH.includes(sphere)) x[sphere] = P.applyWithFloor(x[sphere], amount, state.maxLevel[sphere]);

    if (applied > 0) state.stats.earned += applied; else state.stats.lost -= applied;
    const day = opts.day || today();
    const h = hist(day);
    if (applied > 0) { h.gain += applied; h.g[SPH.includes(sphere) ? sphere : 'other'] += applied; } else h.loss -= applied;
    state.log.unshift({ t: Date.now(), day, amount: applied, sphere: sphere || null, reason });
    if (state.log.length > 400) state.log.length = 400;
    if (!opts.silent) fx.push({ type: 'points', amount: applied, sphere, reason, mentor: opts.mentor });

    const lvl = P.levelFromXp(x.total);
    if (lvl > state.maxLevel.total) {
      state.maxLevel.total = lvl;
      fx.push({ type: 'levelup', level: lvl });
      if (lvl >= 5) unlock('level_5');
      if (lvl >= 10) unlock('level_10');
      if (lvl >= 20) unlock('level_20');
    }
    if (sphere && SPH.includes(sphere)) {
      const sl = P.levelFromXp(x[sphere]);
      if (sl > state.maxLevel[sphere]) state.maxLevel[sphere] = sl;
    }
    return applied;
  }

  function unlock(id) {
    if (state.achievements[id]) return;
    state.achievements[id] = Date.now();
    const a = HQ.data.ACHIEVEMENTS.find((x) => x.id === id);
    if (a) fx.push({ type: 'achievement', achievement: a });
  }

  // ——— Серия ———
  function effectiveStreak() {
    const s = state.streak;
    if (!s.last) return 0;
    const gap = diffDays(s.last, today());
    return gap <= 1 ? s.count : 0;
  }
  function bumpStreak() {
    const s = state.streak, t = today();
    if (s.last === t) return;
    s.count = s.last && diffDays(s.last, t) === 1 ? s.count + 1 : 1;
    s.last = t;
    s.best = Math.max(s.best, s.count);
    if (s.count >= 3) unlock('streak_3');
    if (s.count >= 7) unlock('streak_7');
    if (s.count >= 30) unlock('streak_30');
  }

  // ——— Генерация заданий ———
  function eligible(tpl, tags) {
    if (tpl.ex.some((t) => tags.includes(t))) return false;
    return tpl.req.length === 0 || tpl.req.some((t) => tags.includes(t));
  }

  // Слабые сферы и сферы-фокусы получают больше заданий.
  function sphereWeights() {
    const pr = state.profile || {};
    const scores = pr.scores || { body: 50, mind: 50, spirit: 50 };
    const tags = pr.tags || [];
    const w = {};
    for (const s of SPH) {
      w[s] = 1.6 - (scores[s] || 50) / 100;
      if (tags.includes('focus_' + s)) w[s] += 0.4;
    }
    return w;
  }

  function weightedPick(items, weightOf) {
    const total = items.reduce((a, it) => a + weightOf(it), 0);
    let r = Math.random() * total;
    for (const it of items) { r -= weightOf(it); if (r <= 0) return it; }
    return items[items.length - 1];
  }

  function pickTemplate(sphere, size, avoid) {
    const tags = (state.profile && state.profile.tags) || [];
    let pool = HQ.data.TEMPLATES.filter((t) => t.sphere === sphere && t.size === size && eligible(t, tags) && !avoid.has(t.id));
    if (!pool.length) pool = HQ.data.TEMPLATES.filter((t) => t.sphere === sphere && t.size === size && eligible(t, tags));
    if (!pool.length) return null;
    // Задания, подобранные под метки игрока, выпадают чаще общих.
    return weightedPick(pool, (t) => (t.req.length ? 2 : 1));
  }

  function makeTask(tpl, kind, due) {
    return {
      id: uid(), tpl: tpl.id, title: tpl.title, desc: tpl.desc, sphere: tpl.sphere, size: tpl.size,
      xp: P.SIZES[tpl.size].xp, kind, created: today(), due, status: 'active',
    };
  }

  function dailyPlan(minutes) {
    if (minutes >= 120) return { small: 3, medium: 3 };
    if (minutes >= 60) return { small: 2, medium: 2 };
    if (minutes >= 30) return { small: 3, medium: 1 };
    return { small: 3, medium: 0 };
  }

  function generateDaily() {
    const t = today();
    if (state.tasks.some((x) => x.kind === 'daily' && x.created === t)) return;
    const plan = dailyPlan((state.profile && state.profile.dailyMinutes) || 30);
    const own = state.plans[t] ? planTaskDefs(state.plans[t]).length : 0;
    // Если в планёрке много своих дел, генерируем меньше заданий, но минимум два.
    const target = Math.max(2, plan.small + plan.medium - own);
    while (plan.small + plan.medium > target) { if (plan.medium > 0) plan.medium--; else plan.small--; }
    const yesterday = new Set(state.tasks.filter((x) => x.created === addDays(t, -1)).map((x) => x.tpl));
    const used = new Set(yesterday);
    const weights = sphereWeights();
    const slots = [];
    for (const size of ['small', 'medium']) for (let i = 0; i < plan[size]; i++) slots.push(size);
    // Первые три слота — по одному на сферу, чтобы каждый день был баланс.
    const order = SPH.slice().sort(() => Math.random() - 0.5);
    slots.forEach((size, i) => {
      const sphere = i < 3 ? order[i] : weightedPick(SPH, (s) => weights[s]);
      const tpl = pickTemplate(sphere, size, used);
      if (!tpl) return;
      used.add(tpl.id);
      state.tasks.push(makeTask(tpl, 'daily', t));
    });
    for (const c of state.customTemplates.filter((c) => c.repeat === 'daily')) {
      state.tasks.push({
        id: uid(), tpl: 'custom:' + c.id, title: c.title, desc: c.desc || 'Твоё ежедневное задание', sphere: c.sphere,
        size: c.size, xp: P.SIZES[c.size].xp, kind: 'daily', created: t, due: t, status: 'active', custom: true,
      });
    }
    if (state.plans[t]) applyPlan(t);
  }

  function generateWeekly(force) {
    const t = today();
    const active = state.tasks.some((x) => x.kind === 'weekly' && x.status === 'active');
    if (!force && (active || (state.lastWeeklyGen && diffDays(state.lastWeeklyGen, t) < 7))) return;
    const scores = (state.profile && state.profile.scores) || {};
    const weakest = SPH.slice().sort((a, b) => (scores[a] || 50) - (scores[b] || 50))[0];
    const other = SPH.filter((s) => s !== weakest)[Math.floor(Math.random() * 2)];
    const used = new Set();
    for (const s of [weakest, other]) {
      const tpl = pickTemplate(s, 'large', used);
      if (tpl) { used.add(tpl.id); state.tasks.push(makeTask(tpl, 'weekly', addDays(t, 6))); }
    }
    state.lastWeeklyGen = t;
  }

  // ——— Смена дня: штрафы за пропуски, чистые дни, новые задания ———
  function rollover() {
    if (!state.profile) return;
    const t = today();
    if (!state.lastDay) state.lastDay = t;
    let guard = 0;
    const report = { missed: 0, penalty: 0, clean: 0, days: 0 };
    while (state.lastDay < t && guard++ < 400) {
      closeDay(state.lastDay, report);
      state.lastDay = addDays(state.lastDay, 1);
      report.days++;
    }
    if (report.days) fx.push({ type: 'dayreport', report });
    generateDaily();
    generateWeekly(false);
    pruneOld();
    save();
  }

  function closeDay(day, report = {}) {
    for (const task of state.tasks) {
      if (task.status !== 'active') continue;
      if ((task.kind === 'daily' || task.kind === 'weekly') && task.due && task.due <= day) {
        task.status = 'missed';
        const pen = P.missPenalty(task, difficulty());
        if (pen) report.penalty = (report.penalty || 0) - addPoints(-pen, task.sphere, `Пропущено: ${task.title}`, { silent: true, day });
        hist(day).missed++;
        report.missed = (report.missed || 0) + 1;
      }
    }
    for (const h of state.habits) {
      const days = diffDays(h.cleanSince, day) + 1;
      if (days <= 0) continue;
      const r = P.cleanDayReward(days, nen());
      report.clean = (report.clean || 0) + addPoints(r.base, h.sphere, `Чистый день: ${h.title}`, { silent: true, day });
      if (r.bonus) report.clean += addPoints(r.bonus, h.sphere, `${days} дней без «${h.title}»`, { silent: true, day });
      h.best = Math.max(h.best || 0, days);
      if (days >= 7) unlock('clean_7');
      if (days >= 30) unlock('clean_30');
    }
  }

  function pruneOld() {
    const t = today();
    state.tasks = state.tasks.filter((x) => x.status === 'active' || diffDays(x.created, t) <= 14);
    for (const k of Object.keys(state.days)) if (diffDays(k, t) > 60) delete state.days[k];
    for (const k of Object.keys(state.history)) if (diffDays(k, t) > 400) delete state.history[k];
    for (const k of Object.keys(state.plans)) if (diffDays(k, t) > 60) delete state.plans[k];
  }

  // ——— Действия игрока ———
  function completeTask(id) {
    const task = state.tasks.find((x) => x.id === id);
    if (!task || task.status !== 'active') return;
    bumpStreak();
    const reward = P.taskReward(task, effectiveStreak(), difficulty(), nen());
    task.status = 'done';
    task.doneDay = today();
    task.reward = addPoints(reward, task.sphere, task.title, { mentor: P.SPHERES[task.sphere].mentor });
    const ds = dayStat();
    ds.done++;
    ds.spheres[task.sphere] = (ds.spheres[task.sphere] || 0) + 1;
    hist().done++;
    if (task.main) task.reward += addPoints(P.RULES.mainTaskBonus, task.sphere, 'Главное дело дня сделано', { mentor: 'netero' });
    state.stats.tasksDone++;
    const n = state.stats.tasksDone;
    unlock('first_task');
    if (n >= 10) unlock('tasks_10');
    if (n >= 50) unlock('tasks_50');
    if (n >= 100) unlock('tasks_100');
    if (n >= 500) unlock('tasks_500');
    checkDayBonuses();
    save();
  }

  // Отмена в тот же день — на случай случайного нажатия.
  function undoTask(id) {
    const task = state.tasks.find((x) => x.id === id);
    if (!task || task.status !== 'done' || task.doneDay !== today()) return;
    task.status = 'active';
    addPoints(-(task.reward || 0), task.sphere, `Отмена: ${task.title}`, { silent: true });
    const ds = dayStat();
    ds.done = Math.max(0, ds.done - 1);
    ds.spheres[task.sphere] = Math.max(0, (ds.spheres[task.sphere] || 1) - 1);
    state.stats.tasksDone = Math.max(0, state.stats.tasksDone - 1);
    hist().done = Math.max(0, hist().done - 1);
    delete task.reward; delete task.doneDay;
    save();
  }

  function checkDayBonuses() {
    const ds = dayStat();
    if (!ds.bonuses.balance && SPH.every((s) => ds.spheres[s] > 0)) {
      ds.bonuses.balance = true;
      addPoints(P.RULES.balanceBonus, null, 'Бонус равновесия: все три сферы', { mentor: 'kurapika' });
      unlock('balance');
    }
    const dailies = state.tasks.filter((x) => x.kind === 'daily' && x.created === today());
    if (!ds.bonuses.allDaily && dailies.length && dailies.every((x) => x.status === 'done')) {
      ds.bonuses.allDaily = true;
      addPoints(P.RULES.allDailiesBonus, null, 'Все дневные задания выполнены', { mentor: 'gon' });
      unlock('all_daily');
    }
  }

  function rerollTask(id) {
    const task = state.tasks.find((x) => x.id === id);
    const ds = dayStat();
    if (!task || task.status !== 'active' || task.custom || ds.rerolls >= 1) return false;
    const avoid = new Set(state.tasks.filter((x) => x.status === 'active').map((x) => x.tpl));
    const tpl = pickTemplate(task.sphere, task.size, avoid);
    if (!tpl || tpl.id === task.tpl) return false;
    Object.assign(task, { tpl: tpl.id, title: tpl.title, desc: tpl.desc });
    ds.rerolls++;
    save();
    return true;
  }

  function takeTemplate(tplId) {
    const tpl = HQ.data.TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    state.tasks.push(makeTask(tpl, 'once', null));
    save();
  }

  function addCustom({ title, sphere, size, repeat }) {
    title = (title || '').trim();
    if (!title) return;
    if (repeat === 'daily') {
      const c = { id: uid(), title, sphere, size, repeat };
      state.customTemplates.push(c);
      const t = today();
      state.tasks.push({ id: uid(), tpl: 'custom:' + c.id, title, desc: 'Твоё ежедневное задание', sphere, size,
        xp: P.SIZES[size].xp, kind: 'daily', created: t, due: t, status: 'active', custom: true });
    } else {
      state.tasks.push({ id: uid(), tpl: 'custom', title, desc: 'Твоё задание', sphere, size,
        xp: P.SIZES[size].xp, kind: 'once', created: today(), due: null, status: 'active', custom: true });
    }
    save();
  }

  function removeTask(id) {
    const task = state.tasks.find((x) => x.id === id);
    if (!task) return;
    if (task.tpl && task.tpl.startsWith('custom:')) {
      const cid = task.tpl.slice(7);
      state.customTemplates = state.customTemplates.filter((c) => c.id !== cid);
    }
    state.tasks = state.tasks.filter((x) => x.id !== id);
    save();
  }

  // ——— Арки ———
  function startArc(arcId) {
    if (state.arcs.some((a) => a.arcId === arcId && a.status === 'active')) return;
    if (state.arcs.filter((a) => a.status === 'active').length >= 3) return false;
    const def = HQ.data.ARCS.find((a) => a.id === arcId);
    if (!def) return;
    state.arcs.push({ id: uid(), arcId, steps: def.steps.map(() => false), status: 'active', started: today() });
    save();
    return true;
  }
  function toggleArcStep(id, i) {
    const arc = state.arcs.find((a) => a.id === id);
    if (!arc || arc.status !== 'active') return;
    const def = HQ.data.ARCS.find((a) => a.id === arc.arcId);
    if (arc.steps[i]) return; // шаги не отменяются: арка — это обещание
    arc.steps[i] = true;
    addPoints(P.arcStepReward(difficulty(), nen()), def.sphere, `${def.title}: ${def.steps[i]}`, { mentor: def.mentor });
    if (arc.steps.every(Boolean)) {
      arc.status = 'done';
      arc.finished = today();
      addPoints(P.arcCompleteReward(difficulty(), nen()), def.sphere, `Арка пройдена: ${def.title}`, { mentor: def.mentor });
      unlock('arc_done');
    }
    save();
  }
  function abandonArc(id) { state.arcs = state.arcs.filter((a) => a.id !== id); save(); }

  // ——— Быстрые очки ———
  function quick(id) {
    const q = HQ.data.QUICK.find((x) => x.id === id) || HQ.data.NEGATIVE.find((x) => x.id === id);
    if (!q) return;
    const ds = dayStat();
    const used = ds.quick[id] || 0;
    if (q.cap && used >= q.cap) return;
    ds.quick[id] = used + 1;
    if (q.xp > 0) {
      state.stats.quick++;
      hist().quick++;
      if (state.stats.quick >= 20) unlock('quick_20');
      addPoints(Math.round(q.xp * P.DIFFICULTY[difficulty()].reward), q.sphere, q.label, { mentor: P.SPHERES[q.sphere].mentor });
    } else {
      addPoints(Math.round(q.xp * P.DIFFICULTY[difficulty()].penalty), q.sphere, q.label, { mentor: 'netero' });
    }
    save();
  }

  // ——— Копилка ———
  function addGoal({ title, target }) {
    title = (title || '').trim();
    target = Math.round(Number(target));
    if (!title || !(target > 0)) return;
    state.goals.push({ id: uid(), title, target, saved: 0, hit: {}, created: today(), history: [], done: false });
    save();
  }
  function moveMoney(goalId, amount) {
    const g = state.goals.find((x) => x.id === goalId);
    amount = Math.round(Number(amount));
    if (!g || !amount) return;
    const prev = g.saved;
    const next = Math.max(0, prev + amount);
    const res = P.savingsPoints(prev, next, g.target, g.hit, nen());
    const lastIn = g.history.find((h) => h.amount > 0);
    g.saved = next;
    g.history.unshift({ day: today(), amount: next - prev });
    if (res.points) addPoints(res.points, 'mind', `${amount > 0 ? 'Копилка' : 'Снято из копилки'}: ${g.title}`, { mentor: 'leorio' });
    if (amount > 0) {
      unlock('first_save');
      if (lastIn && diffDays(lastIn.day, today()) <= 8 && lastIn.day !== today()) {
        addPoints(P.RULES.savingsRegular, 'mind', 'Регулярный взнос', { mentor: 'leorio' });
      }
    }
    for (const m of res.milestones) {
      g.hit[m.pct] = true;
      addPoints(m.bonus, 'mind', `Веха ${m.pct}%: ${g.title}`, { mentor: 'leorio' });
    }
    if (g.saved >= g.target && !g.done) { g.done = true; unlock('goal_done'); }
    save();
  }
  function removeGoal(id) { state.goals = state.goals.filter((g) => g.id !== id); save(); }

  // ——— Вредные привычки ———
  function addHabit({ title, sphere = 'body', severity = 'medium', key }) {
    title = (title || '').trim();
    if (!title) return;
    state.habits.push({ id: uid(), key: key || null, title, sphere, severity, cleanSince: today(), best: 0, relapses: [] });
    save();
  }
  function relapse(id) {
    const h = state.habits.find((x) => x.id === id);
    if (!h) return;
    const cur = cleanDays(h);
    h.best = Math.max(h.best || 0, cur);
    h.relapses.unshift(today());
    h.relapses = h.relapses.slice(0, 50);
    h.cleanSince = addDays(today(), 1); // сегодняшний день уже не чистый
    addPoints(-P.relapsePenalty(h.severity, difficulty()), h.sphere, `Срыв: ${h.title}`, { mentor: 'kurapika' });
    save();
  }
  function cleanDays(h) { return Math.max(0, diffDays(h.cleanSince, today())); }
  function removeHabit(id) { state.habits = state.habits.filter((h) => h.id !== id); save(); }

  // ——— Планёрка: что будет в этот день ———
  const WORK = { work: 'Работа', study: 'Учёба', off: 'Выходной' };
  const TRAIN = {
    gym:  { title: 'Тренировка в зале', desc: 'Ты сам запланировал её вчера. Держи слово!' },
    home: { title: 'Домашняя тренировка', desc: '25–30 минут: приседания, отжимания, выпады, планка.' },
    run:  { title: 'Пробежка', desc: 'Темп комфортный, главное — выйти.' },
    rest: null,
  };

  // Какие задания создаст план. Используется и для превью в интерфейсе.
  function planTaskDefs(plan) {
    const defs = [];
    if (plan.main) defs.push({ title: `Главное дело: ${plan.main}`, desc: 'Самое важное на сегодня. Сделай его первым.', sphere: plan.mainSphere || 'mind', size: 'medium', main: true });
    if (plan.work === 'work' || plan.work === 'study') {
      const what = WORK[plan.work];
      defs.push({ title: plan.workTask ? `${what}: ${plan.workTask}` : `${what}: выполнить запланированное`, desc: 'Отметь, когда закончишь рабочий или учебный день с результатом.', sphere: 'mind', size: 'small' });
    }
    const tr = TRAIN[plan.train];
    if (tr) defs.push({ title: tr.title + (plan.trainTime ? ` в ${plan.trainTime}` : ''), desc: tr.desc, sphere: 'body', size: 'medium' });
    for (const it of plan.items || []) if (it.title) defs.push({ title: it.title, desc: 'Из твоей планёрки', sphere: it.sphere || 'mind', size: 'small' });
    return defs;
  }

  function applyPlan(day) {
    const plan = state.plans[day];
    if (!plan || plan.applied) return;
    for (const d of planTaskDefs(plan)) {
      state.tasks.push({ id: uid(), tpl: 'plan', title: d.title, desc: d.desc, sphere: d.sphere, size: d.size,
        xp: P.SIZES[d.size].xp, kind: 'daily', created: day, due: day, status: 'active', custom: true, plan: true, main: !!d.main });
    }
    plan.applied = true;
  }

  function savePlan(day, data) {
    const prev = state.plans[day];
    if (prev && prev.applied) return false; // план уже превратился в задания
    const plan = {
      work: data.work || 'off', workTask: (data.workTask || '').trim().slice(0, 80),
      train: data.train || 'rest', trainTime: (data.trainTime || '').trim().slice(0, 10),
      main: (data.main || '').trim().slice(0, 80), mainSphere: data.mainSphere || 'mind',
      items: (data.items || []).filter((i) => i.title && i.title.trim()).slice(0, 10)
        .map((i) => ({ title: i.title.trim().slice(0, 80), sphere: SPH.includes(i.sphere) ? i.sphere : 'mind' })),
      note: (data.note || '').trim().slice(0, 300),
      saved: Date.now(), applied: false,
    };
    state.plans[day] = plan;
    if (!prev) {
      state.stats.plans++;
      hist().plan = true;
      addPoints(P.RULES.planBonus, 'mind', day === today() ? 'Планёрка на сегодня' : 'Планёрка на завтра', { mentor: 'killua' });
      unlock('plan_1');
      if (state.stats.plans >= 7) unlock('plan_7');
      if (state.stats.plans >= 30) unlock('plan_30');
    }
    if (day === today()) applyPlan(day);
    save();
    return true;
  }

  // ——— Итоги интервью ———
  function finishInterview(answers) {
    const { QUESTIONS, HABITS } = HQ.interview;
    const tags = new Set();
    const acc = { body: [0, 0], mind: [0, 0], spirit: [0, 0] };
    const profile = { name: 'Хантер', dailyMinutes: 30, difficulty: 'normal', nenType: 'specialist', created: today() };

    for (const q of QUESTIONS) {
      const a = answers[q.id];
      if (a === undefined || a === null || a === '') continue;
      if (q.type === 'single') {
        const opt = q.options.find((o) => o.v === a);
        if (!opt) continue;
        (opt.tags || []).forEach((t) => tags.add(t));
        if (q.sphere && typeof opt.s === 'number') { acc[q.sphere][0] += opt.s * q.w; acc[q.sphere][1] += q.w; }
        if (q.field) profile[q.field] = a;
      } else if (q.type === 'multi') {
        for (const v of a) {
          const opt = q.options.find((o) => o.v === v);
          (opt && opt.tags || []).forEach((t) => tags.add(t));
        }
        if (q.field) profile[q.field] = a;
      } else if (q.type === 'scale') {
        const s = q.invert ? (5 - a) / 4 : (a - 1) / 4;
        if (q.sphere) { acc[q.sphere][0] += s * q.w; acc[q.sphere][1] += q.w; }
        if (a <= 2) (q.lowTags || []).forEach((t) => tags.add(t));
        if (a >= 4) (q.highTags || []).forEach((t) => tags.add(t));
      } else if (q.field) {
        profile[q.field] = q.type === 'number' ? Number(a) : String(a).trim();
      }
    }
    if (!profile.name) profile.name = 'Хантер';
    profile.scores = {};
    for (const s of SPH) profile.scores[s] = acc[s][1] ? Math.round(acc[s][0] / acc[s][1] * 100) : 50;
    profile.tags = Array.from(tags);
    if (profile.dreamSkill) profile.tags.push('dream_skill');

    state.profile = profile;
    state.lastDay = today();

    const sev = profile.habitSeverity || null;
    for (const key of (answers.bad || [])) {
      const h = HABITS[key];
      if (h) addHabit({ title: h.title, sphere: h.sphere, severity: sev || h.severity, key });
    }
    if (profile.goalTitle && profile.goalAmount > 0) addGoal({ title: profile.goalTitle, target: profile.goalAmount });

    unlock('license');
    addPoints(P.RULES.welcomeBonus, null, 'Лицензия Хантера получена', { mentor: 'netero' });
    generateDaily();
    generateWeekly(true);
    save();
    return profile;
  }

  function updateProfile(patch) { Object.assign(state.profile, patch); save(); }

  HQ.store = {
    init, save, reset, exportJson, importJson, replaceState,
    onSave(fn) { saveListeners.push(fn); },
    get state() { return state; },
    fx, today, addDays, diffDays, dayStat, effectiveStreak, cleanDays,
    setClock(fn) { clock = fn; },
    rollover, completeTask, undoTask, rerollTask, takeTemplate, addCustom, removeTask,
    startArc, toggleArcStep, abandonArc, quick,
    addGoal, moveMoney, removeGoal, addHabit, relapse, removeHabit,
    finishInterview, updateProfile, generateWeekly, eligible,
    savePlan, planTaskDefs, hist, WORK, TRAIN,
    updateSettings(patch) { Object.assign(state.settings, patch); save(); },
  };
})(typeof self !== 'undefined' ? self : this);
