/*
 * Планёрка: каждый вечер приложение спрашивает, что будет завтра (работа, тренировка,
 * список дел, главное дело, события), а утром предлагает спланировать день, если плана нет.
 * Плюс ежедневные уведомления в Android-приложении (Capacitor LocalNotifications).
 */
(function (root) {
  const HQ = root.HQ;
  const S = HQ.store, P = HQ.points;
  const { esc, sc, sphereLabel, mentorBlock, icon } = HQ.ui.kit;
  const ui = HQ.ui.state;

  const STEPS = ['work', 'train', 'items', 'main', 'summary'];
  const SPH = ['body', 'mind', 'spirit'];

  function dayTitle(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const tomorrow = () => S.addDays(S.today(), 1);

  function openPlan(day) {
    const existing = S.state.plans[day];
    ui.plan = {
      day, step: 0,
      draft: existing ? JSON.parse(JSON.stringify(existing)) : { work: null, workTask: '', train: null, trainTime: '', items: [], main: '', mainSphere: 'mind', note: '' },
    };
    ui.view = 'plan';
    HQ.ui.render();
    window.scrollTo(0, 0);
  }

  // Поля ввода сохраняются в черновик перед каждым переходом.
  function syncInputs() {
    const d = ui.plan.draft;
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
    for (const [id, key] of [['pl-work-task', 'workTask'], ['pl-train-time', 'trainTime'], ['pl-main', 'main'], ['pl-note', 'note']]) {
      const v = val(id);
      if (v !== undefined) d[key] = v;
    }
  }

  // ——— Карточка на главной ———
  HQ.views.planCard = function () {
    const st = S.state, t = S.today(), tm = tomorrow();
    const hour = new Date().getHours();
    const today = st.plans[t];
    let html = '';
    if (today) {
      const bits = [];
      if (today.work && today.work !== 'off') bits.push(S.WORK[today.work]);
      if (today.work === 'off') bits.push('Выходной');
      if (S.TRAIN[today.train]) bits.push(S.TRAIN[today.train].title + (today.trainTime ? ` в ${today.trainTime}` : ''));
      html += `<div class="card plan-today">
        <span class="label">План на сегодня</span>
        <p><b>${esc(bits.join(' · ') || 'День без особых планов')}</b></p>
        ${today.note ? `<p class="muted">${esc(today.note)}</p>` : ''}</div>`;
    } else if (hour < 14) {
      html += planPrompt(t, 'gon', 'Ош! Плана на сегодня нет. Давай быстро решим, что сегодня главное?', 'Спланировать сегодня');
    }
    if (st.plans[tm]) {
      html += `<button class="card plan-done" data-act="plan-open" data-id="${tm}">
        <span class="row"><span class="chip c c-body">✓</span><span style="flex:1;text-align:left">План на завтра готов</span><span class="muted">изменить</span></span></button>`;
    } else if (hour >= 17) {
      html += planPrompt(tm, 'killua', 'Что у нас завтра? Работа, зал, дела. Минута — и я подготовлю задания.', 'Спланировать завтра');
    }
    return html;
  };

  function planPrompt(day, mentor, text, btn) {
    return `<div class="card plan-prompt stack">
      ${mentorBlock(mentor, text, mentor === 'killua' ? 'smirk' : 'happy')}
      <button class="btn primary" data-act="plan-open" data-id="${day}">${icon('plan')}${esc(btn)} <span class="num">+${P.RULES.planBonus}</span></button>
    </div>`;
  }

  // ——— Экран планёрки ———
  function choice(field, value, label, note) {
    const on = ui.plan.draft[field] === value;
    return `<button class="opt${on ? ' on' : ''}" data-act="plan-set" data-field="${field}" data-v="${value}" aria-pressed="${on}">${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</button>`;
  }

  HQ.views.plan = function () {
    if (!ui.plan) { openPlan(tomorrow()); return ''; }
    const { day, step, draft } = ui.plan;
    const isToday = day === S.today();
    const when = isToday ? 'сегодня' : 'завтра';
    const name = STEPS[step];
    let body = '';

    if (name === 'work') {
      body = `
        ${mentorBlock('killua', `Планёрка на ${dayTitle(day)}. Начнём: что ${when} с работой или учёбой?`, 'smirk')}
        <div class="opts">${choice('work', 'work', 'Работа')}${choice('work', 'study', 'Учёба')}${choice('work', 'off', 'Выходной')}</div>
        ${draft.work === 'work' || draft.work === 'study' ? `<div class="field"><label for="pl-work-task">Что главное сделать по ${draft.work === 'work' ? 'работе' : 'учёбе'}?</label>
          <input class="input" id="pl-work-task" maxlength="80" value="${esc(draft.workTask)}" placeholder="Например: сдать отчёт"></div>` : ''}`;
    } else if (name === 'train') {
      body = `
        ${mentorBlock('gon', `А тренировка ${when} будет?`, 'happy')}
        <div class="opts">${choice('train', 'gym', 'Иду в зал')}${choice('train', 'home', 'Тренируюсь дома')}${choice('train', 'run', 'Пробежка')}${choice('train', 'rest', 'День отдыха', 'Тело тоже должно восстанавливаться')}</div>
        ${draft.train && draft.train !== 'rest' ? `<div class="field"><label for="pl-train-time">Во сколько?</label>
          <input class="input" id="pl-train-time" type="time" value="${esc(draft.trainTime)}"></div>` : ''}`;
    } else if (name === 'items') {
      body = `
        ${mentorBlock('leorio', `Какие ещё дела ${when}? Купить, позвонить, записаться — пиши всё. Каждое станет заданием.`, 'happy')}
        <form class="row" data-form="plan-item">
          <input class="input" id="pl-item" name="title" maxlength="80" placeholder="Дело" style="flex:1;min-width:0" autocomplete="off">
          <button class="btn primary" type="submit">Добавить</button>
        </form>
        <div class="stack">${draft.items.length ? draft.items.map((it, i) => `
          <div class="task ${sc(it.sphere)}" style="align-items:center">
            <button class="chip c" data-act="plan-item-sphere" data-i="${i}" title="Сменить сферу">${sphereLabel(it.sphere)}</button>
            <span class="t-title" style="min-width:0">${esc(it.title)}</span>
            <button class="icon-btn" data-act="plan-item-del" data-i="${i}" aria-label="Удалить">${icon('trash')}</button>
          </div>`).join('') : '<div class="empty">Пока пусто. Можно пропустить, если дел нет.</div>'}</div>
        <p class="muted" style="font-size:.82rem">Нажми на сферу, чтобы сменить её: Тело → Разум → Дух.</p>`;
    } else if (name === 'main') {
      body = `
        ${mentorBlock('netero', `Если ${when} получится сделать только одно дело — какое?`, 'happy')}
        <div class="field"><label for="pl-main">Главное дело дня (+${P.RULES.mainTaskBonus} сверху)</label>
          <input class="input" id="pl-main" maxlength="80" value="${esc(draft.main)}" placeholder="Например: дописать курсовую"></div>
        <div class="field"><label>Сфера главного дела</label><div class="opts chips">${SPH.map((s) => choice('mainSphere', s, sphereLabel(s))).join('')}</div></div>
        <div class="field"><label for="pl-note">Что ещё будет ${when}? Встречи, события, настроение</label>
          <textarea class="input plain" id="pl-note" maxlength="300" placeholder="Например: в 15:00 встреча с другом, вечером день рождения у мамы">${esc(draft.note)}</textarea></div>`;
    } else {
      const defs = S.planTaskDefs(draft);
      const total = defs.reduce((a, d) => a + P.SIZES[d.size].xp + (d.main ? P.RULES.mainTaskBonus : 0), 0);
      body = `
        ${mentorBlock('kurapika', `План на ${dayTitle(day)} готов. Это твоя клятва самому себе.`, 'neutral')}
        <div class="stack">${defs.length ? defs.map((d) => `
          <div class="task ${sc(d.sphere)}"><span></span><div class="t-body"><span class="t-title">${esc(d.title)}</span>
            <div class="t-meta"><span class="chip c">${sphereLabel(d.sphere)}</span><span class="chip">${P.SIZES[d.size].label}</span>${d.main ? '<span class="chip c c-aura">главное</span>' : ''}</div></div>
            <span class="xp num">+${P.SIZES[d.size].xp + (d.main ? P.RULES.mainTaskBonus : 0)}</span></div>`).join('') : '<div class="empty">Своих дел нет — будут только задания от наставников.</div>'}</div>
        ${draft.note ? `<div class="card"><span class="label">Заметка</span><p>${esc(draft.note)}</p></div>` : ''}
        <p class="muted">${defs.length ? `За план можно получить до <b class="num">+${total}</b> ауры. ` : ''}Невыполненные дела из плана сгорают в конце дня со штрафом, как обычные дневные задания. За саму планёрку +${P.RULES.planBonus}.</p>`;
    }

    const last = step === STEPS.length - 1;
    const needChoice = (name === 'work' && !draft.work) || (name === 'train' && !draft.train);
    return `
      <div class="row"><button class="btn small ghost" data-act="plan-close">Закрыть</button><span class="spacer"></span>
        <span class="label num">Планёрка · ${step + 1}/${STEPS.length}</span></div>
      <div class="progress"><i style="width:${(step + 1) / STEPS.length * 100}%"></i></div>
      <h1 style="text-transform:capitalize">${esc(dayTitle(day))}</h1>
      ${body}
      <div class="iv-foot">
        ${step > 0 ? '<button class="btn ghost" data-act="plan-back">Назад</button>' : ''}
        <button class="btn primary" data-act="${last ? 'plan-save' : 'plan-next'}" ${needChoice ? 'disabled' : ''}>${last ? 'Сохранить план' : 'Далее'}</button>
      </div>`;
  };

  Object.assign(HQ.viewActions, {
    'plan-open'(d) { openPlan(d.id); },
    'plan-close'() { ui.plan = null; ui.view = 'home'; HQ.ui.render(); },
    'plan-set'(d) {
      syncInputs();
      ui.plan.draft[d.field] = d.v;
      HQ.ui.render();
    },
    'plan-next'() { syncInputs(); ui.plan.step = Math.min(ui.plan.step + 1, STEPS.length - 1); HQ.ui.render(); window.scrollTo(0, 0); },
    'plan-back'() { syncInputs(); ui.plan.step = Math.max(0, ui.plan.step - 1); HQ.ui.render(); },
    'plan-item-sphere'(d) {
      const it = ui.plan.draft.items[Number(d.i)];
      it.sphere = SPH[(SPH.indexOf(it.sphere) + 1) % SPH.length];
      HQ.ui.render();
    },
    'plan-item-del'(d) { ui.plan.draft.items.splice(Number(d.i), 1); HQ.ui.render(); },
    'plan-save'() {
      syncInputs();
      const ok = S.savePlan(ui.plan.day, ui.plan.draft);
      const isToday = ui.plan.day === S.today();
      ui.plan = null;
      ui.view = 'home';
      ui.greeting = { sticky: true, id: 'killua', text: ok ? (isToday ? 'План принят. Задания уже на главной.' : 'Принято. Утром задания будут ждать. Спи нормально!') : 'Этот день уже начался, план не изменить.' };
      HQ.ui.after();
      window.scrollTo(0, 0);
    },
  });

  HQ.viewForms['plan-item'] = function (f) {
    syncInputs();
    const title = f.title.value.trim();
    if (!title) return;
    const items = ui.plan.draft.items;
    if (items.length >= 10) { HQ.ui.toastText('Не больше 10 дел — остальное перенеси'); return; }
    items.push({ title, sphere: 'mind' });
    HQ.ui.render();
    const inp = document.getElementById('pl-item');
    if (inp) inp.focus();
  };

  // ——— Уведомления (только в Android-приложении) ———
  function plugin() {
    const cap = root.Capacitor;
    return cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.LocalNotifications;
  }
  const parseTime = (t) => { const [h, m] = String(t || '').split(':').map(Number); return { hour: h || 0, minute: m || 0 }; };

  const notify = {
    available: () => !!plugin(),
    async init() {
      const LN = plugin();
      if (!LN) return;
      LN.addListener('localNotificationActionPerformed', (e) => {
        const id = e && e.notification && e.notification.id;
        if (id === 101 && S.state.profile) openPlan(tomorrow());
      });
      await notify.schedule();
    },
    async schedule() {
      const LN = plugin();
      if (!LN || !S.state.profile) return;
      try {
        await LN.cancel({ notifications: [{ id: 101 }, { id: 102 }] });
        const set = S.state.settings;
        if (!set.remind) return;
        const perm = await LN.requestPermissions();
        if (perm.display !== 'granted') return;
        await LN.schedule({ notifications: [
          { id: 101, title: 'Планёрка на завтра', body: 'Киллуа: что у нас завтра? Работа, зал, дела. Одна минута.',
            schedule: { on: parseTime(set.planTime), repeats: true, allowWhileIdle: true } },
          { id: 102, title: 'Задания на сегодня', body: 'Гон: Ош! Новые задания уже ждут тебя.',
            schedule: { on: parseTime(set.morningTime), repeats: true, allowWhileIdle: true } },
        ] });
      } catch (e) { /* уведомления недоступны — приложение работает и без них */ }
    },
  };
  HQ.notify = notify;

  HQ.views.notifySettings = function () {
    const set = S.state.settings;
    if (!notify.available()) {
      return `<p class="muted" style="font-size:.85rem">Напоминания о планёрке приходят в Android-приложении. В браузере вечером появится карточка «Спланировать завтра» на главной.</p>`;
    }
    return `
      <label class="row" for="set-remind"><input type="checkbox" id="set-remind" data-setting="remind" ${set.remind ? 'checked' : ''}> <span>Ежедневные напоминания</span></label>
      <div class="grid2">
        <div class="field"><label for="set-plan-time">Планёрка вечером</label><input class="input" type="time" id="set-plan-time" data-setting="planTime" value="${esc(set.planTime)}"></div>
        <div class="field"><label for="set-morning">Задания утром</label><input class="input" type="time" id="set-morning" data-setting="morningTime" value="${esc(set.morningTime)}"></div>
      </div>`;
  };

})(typeof self !== 'undefined' ? self : this);
