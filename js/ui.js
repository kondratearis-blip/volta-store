/*
 * Интерфейс: экраны строятся строками HTML, события — через делегирование по data-act.
 */
(function (root) {
  const HQ = root.HQ;
  const P = HQ.points, S = HQ.store, C = HQ.chars, D = HQ.data, IV = HQ.interview;
  const DRAFT = 'hunterquest.interview';

  HQ.views = HQ.views || {};
  HQ.viewActions = HQ.viewActions || {};
  HQ.viewForms = HQ.viewForms || {};

  const ui = {
    view: 'home', questTab: 'small', confirm: null, modal: null, showJson: false,
    iv: { step: 0, answers: {} },
  };

  // ——— Утилиты ———
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
  const money = (n) => `${fmt(n)} ₽`;
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const sc = (s) => (s ? `c-${s}` : 'c-aura');
  const sphereLabel = (s) => (P.SPHERES[s] ? P.SPHERES[s].label : 'Аура');
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const days = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  function store(k, v) { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* нет хранилища */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    quests: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    goals: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
    habits: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
    reroll: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M20 4v5h-5M4 20v-5h5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    plan: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  function mentorBlock(id, text, mood = 'neutral', big = false) {
    return `<div class="mentor${big ? ' big' : ''}"><div class="pic">${C.chibi(id, mood)}</div>
      <div class="bubble"><div class="who">${esc(C.DEFS[id].name)}</div><p>${esc(text)}</p></div></div>`;
  }

  // ——— Стакан для гадания Нэн ———
  function glass(type) {
    const color = { enhancer: '#5fd39a', transmuter: '#9fd8ff', emitter: '#ff7bb0', conjurer: '#9fd8ff', manipulator: '#9fd8ff', specialist: '#ffb35c' }[type] || '#9fd8ff';
    const crystals = type === 'conjurer' ? '<path class="crystal" d="M50 92l4-6 4 6-4 6z M78 100l3-5 3 5-3 5z M64 84l3-4 3 4-3 4z" fill="#fff"/>' : '';
    const bubbles = type === 'transmuter' ? '<circle class="bubble-dot" cx="56" cy="100" r="2.5" fill="#fff"/><circle class="bubble-dot" cx="80" cy="104" r="2" fill="#fff" style="animation-delay:.7s"/>' : '';
    return `<svg class="glass ${type || ''}" viewBox="0 0 140 140" aria-hidden="true">
      <path d="M30 20 L40 128 Q41 132 46 132 L94 132 Q99 132 100 128 L110 20" fill="rgba(255,255,255,.06)" stroke="#cfd3ff" stroke-width="3" stroke-linejoin="round"/>
      <path class="water" d="M36 56 L43 126 Q44 128 47 128 L93 128 Q96 128 97 126 L104 56 Z" fill="${color}" opacity=".75"/>
      ${crystals}${bubbles}
      <g class="leaf"><ellipse cx="70" cy="52" rx="14" ry="6" fill="#4caf50"/><path d="M57 52 L83 52" stroke="#2e7d32" stroke-width="1.5"/></g>
    </svg>`;
  }

  // ═════════ Интервью ═════════
  function ivSteps() {
    const a = ui.iv.answers;
    const steps = [{ kind: 'welcome' }];
    for (const ch of IV.CHAPTERS) {
      steps.push({ kind: 'chapter', ch });
      for (const q of IV.QUESTIONS.filter((x) => x.ch === ch.id)) {
        if (!q.showIf || q.showIf(a)) steps.push({ kind: 'q', q, ch });
      }
    }
    steps.push({ kind: 'result' });
    return steps;
  }

  function renderInterview() {
    const steps = ivSteps();
    const i = Math.min(ui.iv.step, steps.length - 1);
    const st = steps[i];
    const pct = Math.round(i / (steps.length - 1) * 100);
    const totalQ = steps.filter((s) => s.kind === 'q').length;
    const qNum = steps.slice(0, i + 1).filter((s) => s.kind === 'q').length;
    let body = '';

    if (st.kind === 'welcome') {
      body = `
        <div class="stack" style="gap:18px; padding-top:12px">
          <p class="label">Игра, в которой прокачиваешься ты</p>
          <div class="hero-title">Hunter<br><em>Quest</em></div>
          <div class="cast">${['killua', 'gon', 'netero', 'kurapika', 'leorio'].map((id) => C.chibi(id, id === 'killua' ? 'smirk' : 'happy')).join('')}</div>
          <div class="pillars">
            <div class="pillar c-body"><b>Тело</b><span>сон, спорт, еда</span></div>
            <div class="pillar c-mind"><b>Разум</b><span>учёба, фокус, деньги</span></div>
            <div class="pillar c-spirit"><b>Дух</b><span>смысл, люди, покой</span></div>
          </div>
          ${mentorBlock('netero', `Хо-хо! Сначала большой экзамен: ${totalQ} вопросов обо всех сферах жизни. По ответам я составлю твои задания. Займёт минут десять.`, 'happy')}
        </div>
        <div class="iv-foot"><button class="btn primary" data-act="iv-next">Начать экзамен</button></div>`;
    } else if (st.kind === 'chapter') {
      const idx = IV.CHAPTERS.indexOf(st.ch) + 1;
      body = `
        <div class="stack" style="gap:16px">
          <p class="label">Глава ${idx} из ${IV.CHAPTERS.length}</p>
          <h1>${esc(st.ch.title)}</h1>
          ${mentorBlock(st.ch.mentor, st.ch.text, st.ch.mentor === 'killua' ? 'smirk' : 'happy', true)}
        </div>
        <div class="iv-foot">
          <button class="btn ghost" data-act="iv-back">Назад</button>
          <button class="btn primary" data-act="iv-next">Поехали</button>
        </div>`;
    } else if (st.kind === 'q') {
      body = renderQuestion(st.q, st.ch, qNum, totalQ);
    } else {
      body = renderResult();
    }

    return `<div class="app interview">
      <div class="iv-head"><div class="progress" style="flex:1"><i style="width:${pct}%"></i></div>
        <span class="label num">${pct}%</span></div>
      ${body}</div>`;
  }

  function renderQuestion(q, ch, n, total) {
    const a = ui.iv.answers[q.id];
    let input = '';
    let needNext = true;
    if (q.type === 'single') {
      needNext = false;
      input = `<div class="opts">${q.options.map((o) => `
        <button class="opt${a === o.v ? ' on' : ''}" data-act="iv-pick" data-v="${esc(JSON.stringify(o.v))}">
          ${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</button>`).join('')}</div>`;
    } else if (q.type === 'multi') {
      const sel = Array.isArray(a) ? a : [];
      input = `<div class="opts chips">${q.options.map((o) => `
        <button class="opt${sel.includes(o.v) ? ' on' : ''}" data-act="iv-toggle" data-v="${esc(JSON.stringify(o.v))}" aria-pressed="${sel.includes(o.v)}">${esc(o.label)}</button>`).join('')}</div>`;
    } else if (q.type === 'scale') {
      needNext = false;
      input = `<div class="scale">${[1, 2, 3, 4, 5].map((v) => `
        <button class="opt${a === v ? ' on' : ''}" data-act="iv-pick" data-v="${v}">${v}</button>`).join('')}</div>
        <div class="scale-labels"><span>${esc(q.labels[0])}</span><span style="text-align:right">${esc(q.labels[1])}</span></div>`;
    } else {
      input = `<input class="input" id="iv-input" type="${q.type === 'number' ? 'number' : 'text'}" inputmode="${q.type === 'number' ? 'numeric' : 'text'}"
        placeholder="${esc(q.placeholder || '')}" value="${esc(a == null ? '' : a)}" autocomplete="off" enterkeyhint="next">`;
    }
    const canNext = q.type === 'multi' || q.type === 'text' || q.type === 'number' || (a !== undefined && a !== '') || q.optional;
    const nextLabel = q.optional && (a === undefined || a === '') ? 'Пропустить' : 'Далее';
    return `
      <div class="stack" style="gap:16px">
        <div class="row"><span class="label">${esc(ch.title)} · вопрос ${n} из ${total}</span></div>
        <div class="row" style="align-items:flex-start">
          <div style="width:54px;flex:none">${C.chibi(ch.mentor, 'neutral')}</div>
          <div class="iv-q">${esc(q.q)}</div>
        </div>
        ${q.hint ? `<p class="muted">${esc(q.hint)}</p>` : ''}
        ${input}
      </div>
      <div class="iv-foot">
        <button class="btn ghost" data-act="iv-back">Назад</button>
        ${needNext || a !== undefined ? `<button class="btn primary" data-act="iv-next" ${canNext ? '' : 'disabled'}>${nextLabel}</button>` : ''}
      </div>`;
  }

  function previewScores() {
    // Та же формула, что и в store.finishInterview, но без сохранения.
    const acc = { body: [0, 0], mind: [0, 0], spirit: [0, 0] };
    for (const q of IV.QUESTIONS) {
      const a = ui.iv.answers[q.id];
      if (a === undefined || !q.sphere) continue;
      let s = null;
      if (q.type === 'single') { const o = q.options.find((x) => x.v === a); if (o && typeof o.s === 'number') s = o.s; }
      if (q.type === 'scale') s = q.invert ? (5 - a) / 4 : (a - 1) / 4;
      if (s !== null) { acc[q.sphere][0] += s * q.w; acc[q.sphere][1] += q.w; }
    }
    const r = {};
    for (const k of Object.keys(acc)) r[k] = acc[k][1] ? Math.round(acc[k][0] / acc[k][1] * 100) : 50;
    return r;
  }

  function renderResult() {
    const a = ui.iv.answers;
    const nen = P.NEN[a.nen_water] || P.NEN.specialist;
    const scores = previewScores();
    const weakest = Object.keys(scores).sort((x, y) => scores[x] - scores[y])[0];
    const mentor = P.SPHERES[weakest].mentor;
    return `
      <div class="stack" style="gap:16px">
        <p class="label">Экзамен сдан</p>
        <h1>${esc(a.name || 'Хантер')}, твой тип Нэн — ${esc(nen.name)}</h1>
        ${glass(nen.key)}
        <div class="card stack">
          <p>${esc(nen.water)}.</p>
          <p class="muted">Пассивный бонус: <b style="color:var(--aura)">${esc(nen.bonus)}</b></p>
        </div>
        <div class="stack">
          ${['body', 'mind', 'spirit'].map((s) => `
            <div class="${sc(s)}"><div class="row"><b style="color:var(--c)">${sphereLabel(s)}</b><span class="spacer"></span><span class="num">${scores[s]} / 100</span></div>
            <div class="bar"><i style="width:${scores[s]}%"></i></div></div>`).join('')}
        </div>
        ${mentorBlock(mentor, `Слабее всего сейчас ${sphereLabel(weakest).toLowerCase()}. Я буду давать тебе больше заданий в этой сфере. Не отставай!`, 'happy')}
      </div>
      <div class="iv-foot">
        <button class="btn ghost" data-act="iv-back">Назад</button>
        <button class="btn primary" data-act="iv-finish">Получить лицензию</button>
      </div>`;
  }

  function ivCurrentQuestion() {
    const st = ivSteps()[ui.iv.step];
    return st && st.kind === 'q' ? st.q : null;
  }

  function ivSaveDraft() { store(DRAFT, ui.iv); }

  // ═════════ Основные экраны ═════════
  function topbar() {
    const st = S.state;
    const lp = P.levelProgress(st.xp.total);
    const streak = S.effectiveStreak();
    const C0 = 2 * Math.PI * 22;
    return `<header class="topbar">
      <div class="ring"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none" stroke="var(--surface-2)" stroke-width="5"/>
        <circle cx="26" cy="26" r="22" fill="none" stroke="var(--aura)" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="${C0}" stroke-dashoffset="${C0 * (1 - lp.pct)}"/></svg><div class="lvl num">${lp.level}</div></div>
      <div class="who"><b>${esc(st.profile.name)}</b><span class="num">${esc(P.rankTitle(lp.level))} · ${fmt(lp.into)}/${fmt(lp.need)} ауры</span></div>
      <div class="streak" title="Серия дней"><b class="num">${streak}🔥</b><span class="num">×${P.streakMultiplier(streak).toFixed(2)}</span></div>
    </header>`;
  }

  function spheresRow() {
    const x = S.state.xp;
    return `<div class="spheres">${['body', 'mind', 'spirit'].map((s) => {
      const lp = P.levelProgress(x[s]);
      return `<div class="sphere ${sc(s)}"><span class="name">${sphereLabel(s)}</span><span class="lv num">ур. ${lp.level}</span>
        <div class="bar"><i style="width:${Math.round(lp.pct * 100)}%"></i></div><span class="muted num" style="font-size:.72rem">${fmt(x[s])} xp</span></div>`;
    }).join('')}</div>`;
  }

  function taskRow(t, opts = {}) {
    const ds = S.dayStat();
    const canReroll = t.status === 'active' && !t.custom && ds.rerolls < 1 && opts.reroll;
    const done = t.status === 'done';
    const reward = done ? t.reward : P.taskReward(t, Math.max(S.effectiveStreak(), 1), S.state.profile.difficulty, S.state.profile.nenType);
    let due = '';
    if (t.kind === 'weekly' && t.status === 'active') {
      const left = S.diffDays(S.today(), t.due);
      due = `<span class="chip ${left <= 1 ? 'warn' : ''}">${left <= 0 ? 'последний день' : 'ещё ' + days(left)}</span>`;
    }
    const removable = t.kind === 'once' || (t.custom && !t.plan); // дела из планёрки — обещание, их не удалить
    return `<div class="task ${sc(t.sphere)}${done ? ' done' : ''}">
      <button class="check" data-act="${done ? 'undo' : 'done'}" data-id="${t.id}" aria-label="${done ? 'Отменить' : 'Выполнено'}">${done ? '✓' : ''}</button>
      <div class="t-body">
        <span class="t-title">${esc(t.title)}</span>
        ${t.desc ? `<span class="t-desc">${esc(t.desc)}</span>` : ''}
        <div class="t-meta"><span class="chip c">${sphereLabel(t.sphere)}</span><span class="chip">${P.SIZES[t.size].label}</span>${due}</div>
      </div>
      <div class="t-actions">
        <span class="xp num">${done ? '' : '+'}${reward}</span>
        ${canReroll ? `<button class="icon-btn" data-act="reroll" data-id="${t.id}" aria-label="Заменить задание" title="Заменить (1 раз в день)">${icon('reroll')}</button>` : ''}
        ${removable && !done ? `<button class="icon-btn" data-act="remove-task" data-id="${t.id}" aria-label="Удалить">${icon('trash')}</button>` : ''}
      </div>
    </div>`;
  }

  function greetingMentor() {
    const list = C.LIST;
    const h = new Date().getHours();
    const id = list[(new Date().getDate() + Math.floor(h / 6)) % list.length];
    if (!ui.greeting || (ui.greeting.id !== id && !ui.greeting.sticky)) ui.greeting = { id, text: C.line(id, 'greet') };
    return ui.greeting;
  }

  function viewHome() {
    const st = S.state, t = S.today();
    const daily = st.tasks.filter((x) => x.kind === 'daily' && x.created === t);
    const weekly = st.tasks.filter((x) => x.kind === 'weekly' && (x.status === 'active' || x.doneDay === t));
    const once = st.tasks.filter((x) => x.kind === 'once' && (x.status === 'active' || x.doneDay === t));
    const ds = S.dayStat();
    const doneCount = daily.filter((x) => x.status === 'done').length;
    const g = greetingMentor();
    const spheresDone = ['body', 'mind', 'spirit'].filter((s) => ds.spheres[s] > 0).length;
    return `
      ${HQ.views.planCard ? HQ.views.planCard() : ''}
      ${mentorBlock(g.id, g.text, g.id === 'killua' ? 'smirk' : 'happy')}
      ${spheresRow()}
      <section class="section">
        <div class="section-head"><h2>Сегодня</h2><span class="muted num">${doneCount} из ${daily.length}${ds.rerolls < 1 ? ' · 1 замена' : ''}</span></div>
        ${daily.length ? daily.map((x) => taskRow(x, { reroll: true })).join('') : '<div class="empty">Задания появятся завтра утром.</div>'}
        <div class="bonuses">
          <div class="bonus${ds.bonuses.balance ? ' got' : ''}"><b>+${P.RULES.balanceBonus}</b><span>Равновесие: все 3 сферы (${spheresDone}/3)</span></div>
          <div class="bonus${ds.bonuses.allDaily ? ' got' : ''}"><b>+${P.RULES.allDailiesBonus}</b><span>Все дневные задания</span></div>
        </div>
      </section>
      ${weekly.length ? `<section class="section"><div class="section-head"><h2>Задания недели</h2><span class="muted">большие</span></div>
        ${weekly.map((x) => taskRow(x, { reroll: true })).join('')}</section>` : ''}
      ${once.length ? `<section class="section"><div class="section-head"><h2>Мои задания</h2></div>${once.map((x) => taskRow(x)).join('')}</section>` : ''}
      <section class="section">
        <div class="section-head"><h2>Быстрые очки</h2><span class="muted">сделал — отметь</span></div>
        <div class="quick">${D.QUICK.map((q) => quickBtn(q, ds)).join('')}</div>
      </section>`;
  }

  function quickBtn(q, ds) {
    const used = ds.quick[q.id] || 0;
    const full = q.cap && used >= q.cap;
    const neg = q.xp < 0;
    return `<button class="qbtn ${sc(q.sphere)}${neg ? ' neg' : ''}" data-act="${neg ? 'ask-neg' : 'quick'}" data-id="${q.id}" ${full ? 'disabled' : ''}>
      <span class="q-top"><span class="chip c">${sphereLabel(q.sphere)}</span><span class="xp num ${neg ? 'minus' : ''}">${signed(q.xp)}</span></span>
      <span class="q-label">${esc(q.label)}</span>
      ${q.cap ? `<span class="muted num" style="font-size:.72rem">${used}/${q.cap} сегодня</span>` : ''}</button>`;
  }

  function viewQuests() {
    const st = S.state;
    const tabs = [['small', 'Малые'], ['medium', 'Средние'], ['large', 'Большие'], ['arcs', 'Эпические арки'], ['custom', '+ Своё']];
    let body = '';
    const tab = ui.questTab;
    if (['small', 'medium', 'large'].includes(tab)) {
      const tags = st.profile.tags || [];
      const activeTpl = new Set(st.tasks.filter((x) => x.status === 'active').map((x) => x.tpl));
      const all = D.TEMPLATES.filter((t) => t.size === tab);
      const mine = all.filter((t) => S.eligible(t, tags) && t.req.length);
      const general = all.filter((t) => S.eligible(t, tags) && !t.req.length);
      const size = P.SIZES[tab];
      const list = (arr) => arr.map((t) => `
        <div class="task ${sc(t.sphere)}">
          <span></span>
          <div class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-desc">${esc(t.desc)}</span>
            <div class="t-meta"><span class="chip c">${sphereLabel(t.sphere)}</span><span class="chip">${size.time}</span></div></div>
          <div class="t-actions"><span class="xp num">+${size.xp}</span>
            ${activeTpl.has(t.id) ? '<span class="chip">взято</span>' : `<button class="btn small" data-act="take" data-id="${t.id}">Взять</button>`}</div>
        </div>`).join('');
      body = `
        <p class="muted">${size.label} задание: ${size.time}, базово +${size.xp} ауры. Взятые задания появляются на главной в «Мои задания» и не сгорают.</p>
        ${mine.length ? `<div class="section"><h3>Подобрано по интервью</h3>${list(mine)}</div>` : ''}
        <div class="section"><h3>Для всех</h3>${list(general)}</div>`;
    } else if (tab === 'arcs') {
      const active = st.arcs.filter((a) => a.status === 'active');
      const done = st.arcs.filter((a) => a.status === 'done');
      const busy = new Set(active.map((a) => a.arcId));
      body = `
        <p class="muted">Арка — большой путь из 5 шагов. Каждый шаг даёт +${P.arcStepReward(st.profile.difficulty, st.profile.nenType)}, вся арка ещё +${P.arcCompleteReward(st.profile.difficulty, st.profile.nenType)}. Одновременно можно вести до 3 арок.</p>
        ${active.map((a) => arcCard(a)).join('')}
        <div class="section"><h3>Доступные арки</h3>
        ${D.ARCS.filter((a) => !busy.has(a.id)).map((a) => `
          <div class="card stack ${sc(a.sphere)}">
            <div class="row"><div style="width:48px;flex:none">${C.chibi(a.mentor, 'neutral')}</div>
              <div style="min-width:0"><h3>${esc(a.title)}</h3><span class="chip c">${sphereLabel(a.sphere)}</span></div></div>
            <p class="muted">${esc(a.desc)}</p>
            <button class="btn small" data-act="arc-start" data-id="${a.id}" ${active.length >= 3 ? 'disabled' : ''}>Начать арку</button>
          </div>`).join('')}</div>
        ${done.length ? `<div class="section"><h3>Пройдено</h3>${done.map((a) => `<div class="chip">${esc(D.ARCS.find((x) => x.id === a.arcId).title)} · ${esc(a.finished)}</div>`).join('')}</div>` : ''}`;
    } else {
      body = `
        <form class="card stack" data-form="custom">
          <h3>Своё задание</h3>
          <div class="field"><label for="c-title">Что сделать</label><input class="input" id="c-title" name="title" required maxlength="80" placeholder="Например: 15 минут гитары"></div>
          <div class="grid2">
            <div class="field"><label for="c-sphere">Сфера</label><select class="input" id="c-sphere" name="sphere">
              <option value="body">Тело</option><option value="mind">Разум</option><option value="spirit">Дух</option></select></div>
            <div class="field"><label for="c-size">Размер</label><select class="input" id="c-size" name="size">
              <option value="small">Малое +10</option><option value="medium">Среднее +25</option><option value="large">Большое +60</option></select></div>
          </div>
          <div class="field"><label for="c-repeat">Повтор</label><select class="input" id="c-repeat" name="repeat">
            <option value="once">Один раз, без срока</option><option value="daily">Каждый день (пропуск = штраф)</option></select></div>
          <button class="btn primary" type="submit">Добавить</button>
        </form>
        ${st.customTemplates.length ? `<div class="section"><h3>Ежедневные свои задания</h3>${st.customTemplates.map((c) => `
          <div class="task ${sc(c.sphere)}"><span></span><div class="t-body"><span class="t-title">${esc(c.title)}</span>
          <div class="t-meta"><span class="chip c">${sphereLabel(c.sphere)}</span><span class="chip">${P.SIZES[c.size].label}</span></div></div>
          <div class="t-actions"><button class="icon-btn" data-act="remove-custom" data-id="${c.id}" aria-label="Удалить">${icon('trash')}</button></div></div>`).join('')}</div>` : ''}`;
    }
    return `
      <h1>Задания</h1>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab${tab === k ? ' on' : ''}" data-act="qtab" data-id="${k}" role="tab" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      ${body}`;
  }

  function arcCard(a) {
    const def = D.ARCS.find((x) => x.id === a.arcId);
    const n = a.steps.filter(Boolean).length;
    const confirmKey = 'arc-' + a.id;
    return `<div class="card stack ${sc(def.sphere)}">
      <div class="row"><div style="width:48px;flex:none">${C.chibi(def.mentor, 'happy')}</div>
        <div style="min-width:0;flex:1"><h3>${esc(def.title)}</h3><span class="muted num">${n} из ${def.steps.length} шагов</span></div></div>
      <div class="bar"><i style="width:${n / def.steps.length * 100}%"></i></div>
      ${def.steps.map((s, i) => `<div class="task ${sc(def.sphere)}${a.steps[i] ? ' done' : ''}" style="padding:8px 10px">
        <button class="check" data-act="arc-step" data-id="${a.id}" data-i="${i}" ${a.steps[i] ? 'disabled' : ''} aria-label="Шаг выполнен">${a.steps[i] ? '✓' : ''}</button>
        <div class="t-body"><span class="t-title" style="font-weight:700">${esc(s)}</span></div><span></span></div>`).join('')}
      ${ui.confirm === confirmKey
        ? `<div class="row"><span class="muted" style="flex:1">Бросить арку? Прогресс пропадёт.</span><button class="btn small danger" data-act="arc-abandon" data-id="${a.id}">Бросить</button><button class="btn small" data-act="cancel">Нет</button></div>`
        : `<button class="btn small ghost" data-act="ask" data-id="${confirmKey}">Бросить арку</button>`}
    </div>`;
  }

  function viewGoals() {
    const st = S.state;
    const R = P.RULES;
    return `
      <h1>Копилка</h1>
      ${mentorBlock('leorio', st.goals.length ? C.line('leorio', 'greet') : 'Поставь цель — и каждый отложенный рубль будет приносить ауру. Я тоже коплю, на учёбу!', 'happy')}
      ${st.goals.map((g) => goalCard(g)).join('')}
      <form class="card stack" data-form="goal">
        <h3>Новая цель</h3>
        <div class="field"><label for="g-title">На что копим</label><input class="input" id="g-title" name="title" required maxlength="60" placeholder="Например: новый ноутбук"></div>
        <div class="field"><label for="g-target">Сколько нужно, ₽</label><input class="input" id="g-target" name="target" type="number" inputmode="numeric" min="1" required placeholder="50000"></div>
        <button class="btn primary" type="submit">Поставить цель</button>
      </form>
      <div class="card stack">
        <h3>Как копилка даёт очки</h3>
        <p class="muted">Очки считаются от доли цели, а не от суммы: вся цель — это ${R.savingsFull} очков Разума. Отложил 10% — получил ${R.savingsFull / 10}. Сверху вехи: 25% +${R.savingsMilestones[25]}, 50% +${R.savingsMilestones[50]}, 75% +${R.savingsMilestones[75]}, 100% +${R.savingsMilestones[100]}. Если взносы идут чаще раза в 8 дней, каждый приносит ещё +${R.savingsRegular}. Снятие денег отнимает очки по той же формуле.</p>
      </div>`;
  }

  function goalCard(g) {
    const pct = Math.min(100, g.saved / g.target * 100);
    const confirmKey = 'goal-' + g.id;
    return `<div class="card stack">
      <div class="row"><h3 style="flex:1;min-width:0">${esc(g.title)}</h3>${g.done ? '<span class="chip c c-spirit">Цель достигнута</span>' : `<span class="chip num">${Math.floor(pct)}%</span>`}</div>
      <div class="row wrap"><span class="goal-amt num">${money(g.saved)}</span><span class="muted num">из ${money(g.target)}</span></div>
      <div class="milestones"><i style="width:${pct}%"></i>${[25, 50, 75].map((m) => `<span class="m${g.hit[m] ? ' hit' : ''}" style="left:${m}%"></span>`).join('')}</div>
      <form class="row" data-form="money" data-id="${g.id}">
        <input class="input" name="amount" id="amt-${g.id}" type="number" inputmode="numeric" min="1" placeholder="Сумма, ₽" aria-label="Сумма" style="flex:1;min-width:0">
        <button class="btn small primary" name="dir" value="in" type="submit">Отложить</button>
        <button class="btn small" name="dir" value="out" type="submit">Снять</button>
      </form>
      ${g.history.length ? `<div class="muted num" style="font-size:.8rem">Последнее: ${g.history.slice(0, 3).map((h) => `${h.amount > 0 ? '+' : ''}${fmt(h.amount)} ₽ (${h.day.slice(5)})`).join(' · ')}</div>` : ''}
      ${ui.confirm === confirmKey
        ? `<div class="row"><span class="muted" style="flex:1">Удалить цель? Очки останутся.</span><button class="btn small danger" data-act="goal-remove" data-id="${g.id}">Удалить</button><button class="btn small" data-act="cancel">Нет</button></div>`
        : `<button class="btn small ghost" data-act="ask" data-id="${confirmKey}">Удалить цель</button>`}
    </div>`;
  }

  function viewHabits() {
    const st = S.state;
    const ds = S.dayStat();
    const R = P.RULES;
    const milestones = Object.keys(R.cleanMilestones).map(Number);
    return `
      <h1>Привычки</h1>
      ${mentorBlock('kurapika', st.habits.length ? 'Каждый чистый день — это сдержанная клятва. Срыв — не конец, а честность перед собой.' : 'Вредных привычек нет? Прекрасно. Если появятся — добавь их сюда, и мы начнём бой.', 'neutral')}
      ${st.habits.map((h) => {
        const d = S.cleanDays(h);
        const next = milestones.find((m) => m > d) || null;
        const prev = [...milestones].reverse().find((m) => m <= d) || 0;
        const key = 'relapse-' + h.id, delKey = 'habit-' + h.id;
        return `<div class="card stack ${sc(h.sphere)}">
          <div class="row"><div style="flex:1;min-width:0"><span class="label">Босс</span><h3>${esc(h.title)}</h3></div>
            <div style="text-align:right"><div class="boss-days num">${d}</div><span class="muted">${plural(d, 'чистый день', 'чистых дня', 'чистых дней')}</span></div></div>
          ${next ? `<div class="bar"><i style="width:${(d - prev) / (next - prev) * 100}%"></i></div>
            <span class="muted num" style="font-size:.8rem">До вехи ${days(next)}: ещё ${days(next - d)}, награда +${R.cleanMilestones[next]}</span>` : ''}
          <div class="row wrap"><span class="chip">Рекорд: ${days(Math.max(h.best || 0, d))}</span><span class="chip warn">Срыв −${P.relapsePenalty(h.severity, st.profile.difficulty)}</span><span class="chip">+${R.cleanDay} за каждый день</span></div>
          ${ui.confirm === key
            ? `<div class="row"><span class="muted" style="flex:1">Честно отметить срыв? Счётчик начнётся заново.</span><button class="btn small danger" data-act="relapse" data-id="${h.id}">Да</button><button class="btn small" data-act="cancel">Нет</button></div>`
            : ui.confirm === delKey
              ? `<div class="row"><span class="muted" style="flex:1">Убрать привычку из списка?</span><button class="btn small danger" data-act="habit-remove" data-id="${h.id}">Убрать</button><button class="btn small" data-act="cancel">Нет</button></div>`
              : `<div class="row"><button class="btn small danger" data-act="ask" data-id="${key}" style="flex:1">Был срыв</button><button class="icon-btn" data-act="ask" data-id="${delKey}" aria-label="Удалить привычку">${icon('trash')}</button></div>`}
        </div>`;
      }).join('')}
      <form class="card stack" data-form="habit">
        <h3>Новый босс</h3>
        <div class="field"><label for="h-title">Привычка</label><input class="input" id="h-title" name="title" required maxlength="50" placeholder="Например: ночной холодильник"></div>
        <div class="grid2">
          <div class="field"><label for="h-sphere">Сфера</label><select class="input" id="h-sphere" name="sphere"><option value="body">Тело</option><option value="mind">Разум</option><option value="spirit">Дух</option></select></div>
          <div class="field"><label for="h-sev">Сила</label><select class="input" id="h-sev" name="severity"><option value="light">Слабая −${R.relapse.light}</option><option value="medium" selected>Средняя −${R.relapse.medium}</option><option value="heavy">Сильная −${R.relapse.heavy}</option></select></div>
        </div>
        <button class="btn primary" type="submit">Добавить</button>
      </form>
      <section class="section">
        <div class="section-head"><h2>Честный отчёт</h2><span class="muted">небольшой минус</span></div>
        <p class="muted">Отметь, если было. Честность важнее идеальной статистики: Нетеро ценит её выше очков.</p>
        <div class="quick">${D.NEGATIVE.map((q) => quickBtn(q, ds)).join('')}</div>
      </section>`;
  }

  function viewProfile() {
    const st = S.state, pr = st.profile;
    const nen = P.NEN[pr.nenType] || P.NEN.specialist;
    const lp = P.levelProgress(st.xp.total);
    const R = P.RULES;
    const diff = P.DIFFICULTY[pr.difficulty] || P.DIFFICULTY.normal;
    const rules = [
      ['Малое задание (5–10 мин)', '+10'], ['Среднее задание (20–40 мин)', '+25'], ['Большое задание (1–3 ч)', '+60'],
      ['Шаг эпической арки', `+${R.arcStepXp}`], ['Арка пройдена целиком', `+${P.SIZES.epic.xp}`],
      ['Серия дней: за каждый день', `+${R.streakStep * 100}%, макс. +${R.streakMaxDays * R.streakStep * 100}%`],
      ['Все три сферы за день', `+${R.balanceBonus}`], ['Все дневные задания', `+${R.allDailiesBonus}`],
      ['Копилка: вся цель', `+${R.savingsFull} + вехи`], ['Чистый день по привычке', `+${R.cleanDay}`],
      ['Вехи чистых дней: 3 / 7 / 14 / 30 / 90', '+15 / 50 / 100 / 250 / 700'],
      ['Пропуск дневного задания', `−${R.missRate.daily * 100}% его цены`], ['Пропуск недельного задания', `−${R.missRate.weekly * 100}% его цены`],
      ['Срыв: слабая / средняя / сильная', `−${R.relapse.light} / ${R.relapse.medium} / ${R.relapse.heavy}`],
      ['Режим «' + diff.label + '»', diff.desc],
      ['Уровень N требует', `${R.levelBase}·(N−1)² ауры`],
      ['Защита ранга', 'штрафы не опускают ниже уровня'],
    ];
    return `
      <h1>${esc(pr.name)}</h1>
      <div class="card nen-card">${glass(nen.key)}<div class="stack" style="gap:4px;min-width:0">
        <span class="label">Тип Нэн</span><h2>${esc(nen.name)}</h2><span class="muted">${esc(nen.bonus)}</span>
        <span class="chip c c-aura" style="align-self:flex-start">${esc(P.rankTitle(lp.level))}</span></div></div>
      ${spheresRow()}
      <div class="stats">
        <div class="stat"><b class="num">${fmt(st.xp.total)}</b><span class="muted">аура всего</span></div>
        <div class="stat"><b class="num">${st.stats.tasksDone}</b><span class="muted">заданий выполнено</span></div>
        <div class="stat"><b class="num">${st.streak.best}</b><span class="muted">лучшая серия</span></div>
        <div class="stat"><b class="num"><span class="plus">+${fmt(st.stats.earned)}</span> / <span class="minus">−${fmt(st.stats.lost)}</span></b><span class="muted">получено / потеряно</span></div>
      </div>
      <section class="section"><div class="section-head"><h2>Достижения</h2><span class="muted num">${Object.keys(st.achievements).length}/${D.ACHIEVEMENTS.length}</span></div>
        <div class="ach">${D.ACHIEVEMENTS.map((a) => `<div class="a${st.achievements[a.id] ? '' : ' locked'}">${C.chibi(a.mentor, st.achievements[a.id] ? 'happy' : 'neutral')}
          <div style="min-width:0"><b>${esc(a.title)}</b><span>${esc(a.desc)}</span></div></div>`).join('')}</div></section>
      <details class="card"><summary>Кодекс Хантера: правила очков</summary>
        <table class="rules"><tbody>${rules.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></details>
      <details class="card"><summary>История ауры</summary>
        <div class="log">${st.log.slice(0, 60).map((l) => `<div class="li"><span class="muted num" style="min-width:42px">${l.day.slice(5)}</span>
          <span style="flex:1;min-width:0">${esc(l.reason)}</span><span class="amt num ${l.amount >= 0 ? 'plus' : 'minus'}">${signed(l.amount)}</span></div>`).join('') || '<p class="muted">Пока пусто</p>'}</div></details>
      <details class="card"><summary>Ответы интервью</summary>
        <div class="stack muted" style="font-size:.88rem">
          ${pr.career ? `<p>Карьера: <b>${esc(pr.career)}</b></p>` : ''}${pr.dreamSkill ? `<p>Навык мечты: <b>${esc(pr.dreamSkill)}</b></p>` : ''}
          ${pr.values ? `<p>Ценности: <b>${esc(pr.values.join(', '))}</b></p>` : ''}${pr.freeYear ? `<p>Свободный год: <b>${esc(pr.freeYear)}</b></p>` : ''}
          <p>Стартовые оценки: тело ${pr.scores.body}, разум ${pr.scores.mind}, дух ${pr.scores.spirit}</p></div></details>
      <details class="card"><summary>Настройки</summary>
        <div class="stack">
          <div class="field"><label for="set-diff">Режим</label><select class="input" id="set-diff" data-change="difficulty">
            ${Object.values(P.DIFFICULTY).map((d) => `<option value="${d.key}"${pr.difficulty === d.key ? ' selected' : ''}>${d.label}: ${d.desc}</option>`).join('')}</select></div>
          <div class="field"><label for="set-min">Время в день (со следующего дня)</label><select class="input" id="set-min" data-change="dailyMinutes">
            ${[[15, '15 минут'], [30, '30 минут'], [60, 'Около часа'], [120, '2 часа']].map(([v, l]) => `<option value="${v}"${Number(pr.dailyMinutes) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="set-name">Имя</label><input class="input" id="set-name" data-change="name" value="${esc(pr.name)}" maxlength="30"></div>
          ${HQ.views.notifySettings ? HQ.views.notifySettings() : ''}
          <button class="btn ghost" data-act="toggle-json">${ui.showJson ? 'Скрыть резервную копию' : 'Резервная копия'}</button>
          ${ui.showJson ? `<p class="muted" style="font-size:.85rem">Скопируй текст и сохрани в заметках. Чтобы восстановить — вставь сохранённый текст и нажми «Восстановить».</p>
            <textarea class="input" id="json-box" spellcheck="false">${esc(S.exportJson())}</textarea>
            <div class="grid2"><button class="btn small" data-act="copy-json">Скопировать</button><button class="btn small" data-act="import-json">Восстановить</button></div>` : ''}
          ${ui.confirm === 'reset'
            ? `<div class="row"><span class="muted" style="flex:1">Стереть весь прогресс и пройти интервью заново?</span><button class="btn small danger" data-act="reset">Стереть</button><button class="btn small" data-act="cancel">Нет</button></div>`
            : '<button class="btn danger" data-act="ask" data-id="reset">Начать заново</button>'}
        </div></details>
      <p class="muted" style="font-size:.75rem;text-align:center">Hunter Quest · персонажи — фан-арт по мотивам Hunter × Hunter (Ёсихиро Тогаси), для личного использования</p>`;
  }

  function nav() {
    const items = [['home', 'Главная'], ['quests', 'Задания'], ['stats', 'Прогресс'], ['goals', 'Копилка'], ['habits', 'Привычки'], ['profile', 'Профиль']];
    return `<nav class="nav"><div class="in">${items.map(([k, l]) => `<button class="${ui.view === k ? 'on' : ''}" data-act="nav" data-id="${k}" aria-current="${ui.view === k ? 'page' : 'false'}">${icon(k)}<span>${l}</span></button>`).join('')}</div></nav>`;
  }

  // ═════════ Рендер, тосты, модалки ═════════
  const VIEWS = { home: viewHome, quests: viewQuests, goals: viewGoals, habits: viewHabits, profile: viewProfile };

  function render() {
    const el = document.getElementById('app');
    if (!S.state.profile) {
      el.innerHTML = renderInterview();
      const inp = document.getElementById('iv-input');
      if (inp) inp.focus({ preventScroll: true });
    } else {
      el.innerHTML = `<div class="app">${topbar()}${(VIEWS[ui.view] || HQ.views[ui.view] || viewHome)()}</div>${nav()}`;
    }
    renderModal();
  }

  function flushFx() {
    const box = document.getElementById('toasts');
    while (S.fx.length) {
      const f = S.fx.shift();
      if (f.type === 'points') {
        const mentor = f.mentor || (f.sphere ? P.SPHERES[f.sphere].mentor : 'netero');
        const good = f.amount >= 0;
        toast(`<div class="face">${C.chibi(mentor, good ? 'happy' : 'sad')}</div>
          <div class="txt"><b class="amt ${good ? 'plus' : 'minus'}">${signed(f.amount)} ${f.sphere ? sphereLabel(f.sphere) : 'аура'}</b>
          <small>${esc(f.reason)}</small><small>${esc(C.line(mentor, good ? 'done' : 'miss'))}</small></div>`, box);
      } else if (f.type === 'achievement') {
        toast(`<div class="face">${C.chibi(f.achievement.mentor, 'happy')}</div>
          <div class="txt"><b>Достижение: ${esc(f.achievement.title)}</b><small>${esc(f.achievement.desc)}</small></div>`, box);
      } else if (f.type === 'dayreport') {
        const r = f.report;
        if (!r.missed && !r.clean) continue;
        ui.modal = { type: 'day', report: r };
        renderModal();
      } else if (f.type === 'levelup') {
        ui.modal = { type: 'level', level: f.level };
        renderModal();
      }
    }
  }

  function toast(html, box) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    box.appendChild(t);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => t.remove(), 2800);
  }

  function renderModal() {
    const m = document.getElementById('modal');
    if (!ui.modal) { m.hidden = true; m.innerHTML = ''; return; }
    m.hidden = false;
    if (ui.modal.type === 'level') {
      const lvl = ui.modal.level;
      m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Новый уровень">
        <svg class="big" viewBox="0 0 100 120">${C.chibi('netero', 'happy').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
        <span class="label">Новый уровень</span><div class="lvl-big num">${lvl}</div>
        <h2>${esc(P.rankTitle(lvl))}</h2>
        <p class="muted">Хо-хо! Твоя аура окрепла. Продолжай в том же духе, юный Хантер.</p>
        <button class="btn primary block" data-act="close-modal">Ош!</button></div>`;
    } else if (ui.modal.type === 'day') {
      const r = ui.modal.report;
      const bad = r.missed > 0;
      const id = bad ? 'kurapika' : 'gon';
      m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Итоги дня">
        <svg class="big" viewBox="0 0 100 120">${C.chibi(id, bad ? 'angry' : 'happy').replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
        <span class="label">Новый день</span>
        ${r.missed ? `<p>Пропущено заданий: <b>${r.missed}</b>, аура <b class="minus num">−${r.penalty}</b></p>` : ''}
        ${r.clean ? `<p>Чистые дни по привычкам: <b class="plus num">+${r.clean}</b></p>` : ''}
        <p class="muted">${esc(C.line(id, bad ? 'miss' : 'done'))}</p>
        <button class="btn primary block" data-act="close-modal">К заданиям</button></div>`;
    }
  }

  // ═════════ Обработчики ═════════
  function after() { render(); flushFx(); }

  const actions = {
    'iv-next'() {
      const q = ivCurrentQuestion();
      if (q && (q.type === 'text' || q.type === 'number')) {
        const v = document.getElementById('iv-input').value.trim();
        if (v === '') delete ui.iv.answers[q.id];
        else ui.iv.answers[q.id] = q.type === 'number' ? Math.max(0, Number(v) || 0) : v.slice(0, 120);
        if (!q.optional && !v) { toastText('Напиши ответ, чтобы продолжить'); return; }
      }
      ui.iv.step = Math.min(ui.iv.step + 1, ivSteps().length - 1);
      ivSaveDraft(); render(); window.scrollTo(0, 0);
    },
    'iv-back'() { ui.iv.step = Math.max(0, ui.iv.step - 1); ivSaveDraft(); render(); },
    'iv-pick'(d) {
      const q = ivCurrentQuestion();
      ui.iv.answers[q.id] = JSON.parse(d.v);
      ivSaveDraft(); render();
      clearTimeout(ui.pickTimer);
      const step = ui.iv.step;
      ui.pickTimer = setTimeout(() => { if (ui.iv.step === step) actions['iv-next'](); }, 180);
    },
    'iv-toggle'(d) {
      const q = ivCurrentQuestion();
      const v = JSON.parse(d.v);
      const opt = q.options.find((o) => o.v === v);
      let sel = Array.isArray(ui.iv.answers[q.id]) ? ui.iv.answers[q.id].slice() : [];
      if (sel.includes(v)) sel = sel.filter((x) => x !== v);
      else if (opt.exclusive) sel = [v];
      else {
        sel = sel.filter((x) => !(q.options.find((o) => o.v === x) || {}).exclusive);
        if (q.max && sel.length >= q.max) sel.shift();
        sel.push(v);
      }
      ui.iv.answers[q.id] = sel;
      ivSaveDraft(); render();
    },
    'iv-finish'() {
      S.finishInterview(ui.iv.answers);
      store(DRAFT);
      ui.view = 'home';
      ui.greeting = { sticky: true, id: 'netero', text: 'Лицензия твоя! Вот первые задания. Начни с малого — с одного шага.' };
      after(); window.scrollTo(0, 0);
    },
    nav(d) { ui.view = d.id; ui.confirm = null; render(); window.scrollTo(0, 0); },
    qtab(d) { ui.questTab = d.id; render(); },
    done(d) { S.completeTask(d.id); after(); },
    undo(d) { S.undoTask(d.id); after(); },
    reroll(d) { S.rerollTask(d.id); after(); },
    take(d) { S.takeTemplate(d.id); toastText('Задание добавлено на главную'); render(); },
    'remove-task'(d) { S.removeTask(d.id); render(); },
    'remove-custom'(d) {
      const st = S.state;
      st.customTemplates = st.customTemplates.filter((c) => c.id !== d.id);
      st.tasks = st.tasks.filter((t) => !(t.tpl === 'custom:' + d.id && t.status === 'active'));
      S.save(); render();
    },
    'arc-start'(d) { S.startArc(d.id); render(); },
    'arc-step'(d) { S.toggleArcStep(d.id, Number(d.i)); after(); },
    'arc-abandon'(d) { ui.confirm = null; S.abandonArc(d.id); render(); },
    quick(d) { S.quick(d.id); after(); },
    'ask-neg'(d) { S.quick(d.id); after(); },
    ask(d) { ui.confirm = d.id; render(); },
    cancel() { ui.confirm = null; render(); },
    relapse(d) { ui.confirm = null; S.relapse(d.id); after(); },
    'habit-remove'(d) { ui.confirm = null; S.removeHabit(d.id); render(); },
    'goal-remove'(d) { ui.confirm = null; S.removeGoal(d.id); render(); },
    'close-modal'() { ui.modal = null; renderModal(); },
    'toggle-json'() { ui.showJson = !ui.showJson; render(); },
    'copy-json'() {
      const box = document.getElementById('json-box');
      const done = () => toastText('Скопировано');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(box.value).then(done, () => { box.select(); });
      else box.select();
    },
    'import-json'() {
      try { S.importJson(document.getElementById('json-box').value); ui.showJson = false; toastText('Прогресс восстановлен'); render(); }
      catch (e) { toastText('Не получилось: ' + e.message); }
    },
    reset() { ui.confirm = null; S.reset(); ui.iv = { step: 0, answers: {} }; store(DRAFT); render(); },
  };

  function toastText(text) {
    toast(`<div class="txt"><b>${esc(text)}</b></div>`, document.getElementById('toasts'));
  }

  const forms = {
    custom(f) { S.addCustom({ title: f.title.value, sphere: f.sphere.value, size: f.size.value, repeat: f.repeat.value }); toastText('Задание добавлено'); render(); },
    goal(f) { S.addGoal({ title: f.title.value, target: f.target.value }); render(); },
    habit(f) { S.addHabit({ title: f.title.value, sphere: f.sphere.value, severity: f.severity.value }); render(); },
    money(f, submitter) {
      const amount = Math.abs(Math.round(Number(f.amount.value)));
      if (!amount) return;
      S.moveMoney(f.dataset.id, submitter && submitter.value === 'out' ? -amount : amount);
      after();
    },
  };

  function bind() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = actions[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el.dataset, el); }
    });
    document.addEventListener('submit', (e) => {
      const f = e.target.closest('form[data-form]');
      if (!f) return;
      e.preventDefault();
      (forms[f.dataset.form] || HQ.viewForms[f.dataset.form])(f, e.submitter);
    });
    document.addEventListener('change', (e) => {
      const set = e.target.closest('[data-setting]');
      if (set) {
        S.updateSettings({ [set.dataset.setting]: set.type === 'checkbox' ? set.checked : set.value });
        if (HQ.notify) HQ.notify.schedule();
        render();
        return;
      }
      const el = e.target.closest('[data-change]');
      if (!el) return;
      const key = el.dataset.change;
      let v = el.value;
      if (key === 'dailyMinutes') v = Number(v);
      if (key === 'name') { v = v.trim(); if (!v) return; }
      S.updateProfile({ [key]: v });
      render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'iv-input') { e.preventDefault(); actions['iv-next'](); }
    });
    // Новый день, пока приложение открыто
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && S.state.profile && S.state.lastDay !== S.today()) { S.rollover(); after(); }
    });
  }

  function start() {
    S.init();
    const draft = load(DRAFT);
    if (draft && draft.answers) ui.iv = draft;
    if (S.state.profile) S.rollover();
    Object.assign(actions, HQ.viewActions);
    bind();
    if (HQ.notify) HQ.notify.init();
    render();
    flushFx();
  }

  HQ.ui = {
    start, render, after, state: ui, toastText,
    kit: { esc, fmt, money, signed, sc, sphereLabel, plural, days, icon, mentorBlock, taskRow },
  };
})(typeof self !== 'undefined' ? self : this);
