/*
 * Вкладка «Прогресс»: уровни, аура по дням, рост ауры, сферы, календарь активности.
 * Графики — инлайн SVG. Касание столбика или точки выбирает день и показывает подробности.
 */
(function (root) {
  const HQ = root.HQ;
  const S = HQ.store, P = HQ.points;
  const { esc, fmt, signed, sc, sphereLabel, plural } = HQ.ui.kit;
  const ui = HQ.ui.state;
  const SPH = ['body', 'mind', 'spirit'];
  const SERIES = [
    { key: 'body', label: 'Тело', color: 'var(--ch-body)' },
    { key: 'mind', label: 'Разум', color: 'var(--ch-mind)' },
    { key: 'spirit', label: 'Дух', color: 'var(--ch-spirit)' },
    { key: 'other', label: 'Бонусы', color: 'var(--ch-other)' },
  ];
  const EMPTY = { gain: 0, loss: 0, g: { body: 0, mind: 0, spirit: 0, other: 0 }, done: 0, missed: 0, quick: 0, plan: false };
  const H = (k) => S.state.history[k] || EMPTY;

  function parse(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  const short = (k) => parse(k).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  const wd = (k) => parse(k).toLocaleDateString('ru-RU', { weekday: 'short' });

  // Корзины: при 7 и 30 днях — по дню, при 90 — по неделе.
  function buckets(period) {
    const t = S.today();
    const size = period > 30 ? 7 : 1;
    const n = Math.ceil(period / size);
    const out = [];
    for (let b = n - 1; b >= 0; b--) {
      const dayKeys = [];
      for (let i = size - 1; i >= 0; i--) dayKeys.push(S.addDays(t, -(b * size + i)));
      const agg = { days: dayKeys, gain: 0, loss: 0, g: { body: 0, mind: 0, spirit: 0, other: 0 }, done: 0, missed: 0, quick: 0 };
      for (const k of dayKeys) {
        const h = H(k);
        agg.gain += h.gain; agg.loss += h.loss; agg.done += h.done; agg.missed += h.missed; agg.quick += h.quick;
        for (const s of Object.keys(agg.g)) agg.g[s] += h.g[s] || 0;
      }
      agg.net = agg.gain - agg.loss;
      agg.label = size === 1 ? (period <= 7 ? wd(dayKeys[0]) : short(dayKeys[0])) : short(dayKeys[0]);
      agg.title = size === 1 ? short(dayKeys[0]) : `${short(dayKeys[0])} – ${short(dayKeys[dayKeys.length - 1])}`;
      out.push(agg);
    }
    return out;
  }

  function sumRange(fromOffset, len) {
    const t = S.today();
    const r = { gain: 0, loss: 0, done: 0, missed: 0, g: { body: 0, mind: 0, spirit: 0, other: 0 } };
    for (let i = fromOffset; i < fromOffset + len; i++) {
      const h = H(S.addDays(t, -i));
      r.gain += h.gain; r.loss += h.loss; r.done += h.done; r.missed += h.missed;
      for (const s of Object.keys(r.g)) r.g[s] += h.g[s] || 0;
    }
    r.net = r.gain - r.loss;
    return r;
  }

  const niceMax = (v) => {
    if (v <= 10) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };

  // Путь столбика со скруглением 4px только на внешнем конце (у базовой линии — прямой угол).
  function barPath(x, y0, w, h, up) {
    const r = Math.min(4, w / 2, Math.abs(h));
    if (up) {
      const y = y0 - h;
      return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`;
    }
    const y = y0 + h;
    return `M${x},${y0}V${y - r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y - r}V${y0}Z`;
  }

  function barChart(bs, sel) {
    const W = 340, H0 = 190, L = 34, R = 6, T = 10, B = 22;
    const pw = W - L - R, ph = H0 - T - B;
    const maxUp = niceMax(Math.max(1, ...bs.map((b) => b.gain)));
    const maxDown = Math.max(0, ...bs.map((b) => b.loss));
    const down = maxDown > 0 ? niceMax(maxDown) : 0;
    const scale = ph / (maxUp + down);
    const y0 = T + maxUp * scale;
    const step = pw / bs.length;
    const bw = Math.max(2, Math.min(26, step * 0.62));
    let marks = '', hits = '', labels = '';
    const every = bs.length > 14 ? Math.ceil(bs.length / 6) : 1;
    bs.forEach((b, i) => {
      const x = L + i * step + (step - bw) / 2;
      const dim = sel !== null && sel !== i ? ' opacity=".35"' : '';
      let acc = 0;
      const segs = SERIES.filter((s) => b.g[s.key] > 0);
      segs.forEach((s, j) => {
        const h = b.g[s.key] * scale;
        const top = j === segs.length - 1;
        const yb = y0 - acc;
        // 2px зазор между сегментами — цвет поверхности
        const gap = j > 0 ? 2 : 0;
        if (h - gap > 0.5) {
          marks += top
            ? `<path d="${barPath(x, yb - gap, bw, h - gap, true)}" fill="${s.color}"${dim}/>`
            : `<rect x="${x}" y="${yb - h}" width="${bw}" height="${h - gap}" fill="${s.color}"${dim}/>`;
        }
        acc += h;
      });
      if (b.loss > 0) marks += `<path d="${barPath(x, y0 + 1, bw, Math.max(2, b.loss * scale - 1), false)}" fill="var(--danger)"${dim}/>`;
      hits += `<rect x="${L + i * step}" y="${T}" width="${step}" height="${ph}" fill="transparent" data-act="stat-pick" data-i="${i}" style="cursor:pointer"><title>${esc(b.title)}: ${signed(b.net)}</title></rect>`;
      if (i % every === 0 || i === bs.length - 1) labels += `<text x="${L + i * step + step / 2}" y="${H0 - 6}" text-anchor="middle" class="ax">${esc(b.label)}</text>`;
    });
    const grid = [maxUp, maxUp / 2].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y0 - v * scale}" y2="${y0 - v * scale}" class="gl"/>
      <text x="${L - 6}" y="${y0 - v * scale + 4}" text-anchor="end" class="ax">${fmt(v)}</text>`).join('')
      + `<text x="${L - 6}" y="${y0 + 4}" text-anchor="end" class="ax">0</text>`
      + (down * scale >= 16 ? `<text x="${L - 6}" y="${y0 + down * scale}" text-anchor="end" class="ax">−${fmt(down)}</text>` : '');
    return `<svg viewBox="0 0 ${W} ${H0}" class="chart" role="img" aria-label="Аура по дням">
      ${grid}<line x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" class="base"/>${marks}${labels}${hits}</svg>`;
  }

  function lineChart(bs, sel) {
    // Значение ауры на конец каждой корзины: идём назад от текущей суммы.
    const vals = new Array(bs.length);
    let v = S.state.xp.total;
    for (let i = bs.length - 1; i >= 0; i--) { vals[i] = v; v -= bs[i].net; }
    const start = Math.max(0, v);
    const W = 340, H0 = 170, L = 40, R = 14, T = 16, B = 22;
    const pw = W - L - R, ph = H0 - T - B;
    let lo = Math.min(start, ...vals), hi = Math.max(...vals);
    if (hi - lo < 10) { hi += 5; lo = Math.max(0, lo - 5); }
    const X = (i) => L + (bs.length === 1 ? pw : i / (bs.length - 1) * pw);
    const Y = (val) => T + (1 - (val - lo) / (hi - lo)) * ph;
    const pts = vals.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`);
    const line = `M${pts.join('L')}`;
    const area = `${line}L${X(bs.length - 1)},${T + ph}L${X(0)},${T + ph}Z`;
    const last = bs.length - 1;
    const step = pw / Math.max(1, bs.length - 1);
    let hits = '';
    bs.forEach((b, i) => {
      hits += `<rect x="${X(i) - step / 2}" y="${T}" width="${step}" height="${ph}" fill="transparent" data-act="stat-pick" data-i="${i}" style="cursor:pointer"><title>${esc(b.title)}: ${fmt(vals[i])}</title></rect>`;
    });
    // Уровни, которые попадают в диапазон, — тонкие отметки.
    let levels = '';
    for (let l = P.levelFromXp(lo) + 1; P.xpForLevel(l) <= hi; l++) {
      const y = Y(P.xpForLevel(l));
      levels += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="gl dash"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="ax">ур.${l}</text>`;
    }
    const s = sel !== null ? sel : null;
    const marker = s !== null ? `<line x1="${X(s)}" x2="${X(s)}" y1="${T}" y2="${T + ph}" class="cross"/>
      <circle cx="${X(s)}" cy="${Y(vals[s])}" r="5" fill="var(--aura)" stroke="var(--surface)" stroke-width="2"/>` : '';
    const every = bs.length > 14 ? Math.ceil(bs.length / 6) : 1;
    const labels = bs.map((b, i) => (i % every === 0 || i === last) ? `<text x="${X(i)}" y="${H0 - 6}" text-anchor="middle" class="ax">${esc(b.label)}</text>` : '').join('');
    return `<svg viewBox="0 0 ${W} ${H0}" class="chart" role="img" aria-label="Рост ауры">
      <defs><linearGradient id="aura-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--aura)" stop-opacity=".28"/><stop offset="1" stop-color="var(--aura)" stop-opacity="0"/></linearGradient></defs>
      <line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" class="base"/>
      ${levels}
      <path d="${area}" fill="url(#aura-fill)"/>
      <path d="${line}" fill="none" stroke="var(--aura)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(last)}" cy="${Y(vals[last])}" r="4.5" fill="var(--aura)" stroke="var(--surface)" stroke-width="2"/>
      <text x="${X(last) - 6}" y="${Y(vals[last]) - 9}" text-anchor="end" class="ax strong">${fmt(vals[last])}</text>
      ${marker}${labels}${hits}</svg>`;
  }

  function heatmap() {
    const t = S.today();
    const weeks = 12;
    const dow = (parse(t).getDay() + 6) % 7; // 0 = понедельник
    const startKey = S.addDays(t, -(weeks - 1) * 7 - dow);
    const cell = 22, gap = 4, L = 22;
    let cells = '';
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const k = S.addDays(startKey, w * 7 + d);
        if (k > t) continue;
        const h = H(k);
        const lvl = h.done === 0 ? 0 : h.done <= 2 ? 1 : h.done <= 4 ? 2 : h.done <= 6 ? 3 : 4;
        const sel = ui.heatDay === k ? ' stroke="var(--text)" stroke-width="2"' : '';
        cells += `<rect x="${L + w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="5" class="hm l${lvl}"${sel}
          data-act="stat-heat" data-id="${k}" style="cursor:pointer"><title>${esc(short(k))}: ${h.done} ${plural(h.done, 'задание', 'задания', 'заданий')}</title></rect>`;
      }
    }
    const rows = ['пн', '', 'ср', '', 'пт', '', 'вс'].map((l, d) => l ? `<text x="0" y="${d * (cell + gap) + 15}" class="ax">${l}</text>` : '').join('');
    const W = L + weeks * (cell + gap), H0 = 7 * (cell + gap);
    return `<svg viewBox="0 0 ${W} ${H0}" class="chart" role="img" aria-label="Календарь активности за 12 недель">${rows}${cells}</svg>`;
  }

  function delta(cur, prev) {
    if (!prev) return cur > 0 ? '<span class="delta up">новое</span>' : '';
    const d = Math.round((cur - prev) / Math.abs(prev) * 100);
    if (!d) return '<span class="delta">как раньше</span>';
    return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}%</span>`;
  }

  function dayDetail(b) {
    const parts = SERIES.filter((s) => b.g[s.key] > 0).map((s) => `<span class="row" style="gap:6px"><i class="sw" style="background:${s.color}"></i>${s.label} <b class="num">+${fmt(b.g[s.key])}</b></span>`);
    if (b.loss) parts.push(`<span class="row" style="gap:6px"><i class="sw" style="background:var(--danger)"></i>Потери <b class="num">−${fmt(b.loss)}</b></span>`);
    return `<div class="detail">
      <div class="row"><b>${esc(b.title)}</b><span class="spacer"></span><b class="num ${b.net >= 0 ? 'plus' : 'minus'}">${signed(b.net)} ауры</b></div>
      <div class="row wrap" style="gap:12px;font-size:.85rem">${parts.join('') || '<span class="muted">Нет активности</span>'}</div>
      <div class="muted num" style="font-size:.82rem">Заданий: ${b.done} · пропущено: ${b.missed} · быстрых очков: ${b.quick}</div></div>`;
  }

  HQ.views.stats = function () {
    const st = S.state;
    const period = ui.statPeriod || 7;
    const bs = buckets(period);
    if (ui.statSel !== null && ui.statSel !== undefined && ui.statSel >= bs.length) ui.statSel = null;
    const sel = ui.statSel === undefined ? null : ui.statSel;
    const cur = sumRange(0, period), prev = sumRange(period, period);
    const rate = cur.done + cur.missed ? Math.round(cur.done / (cur.done + cur.missed) * 100) : null;
    const lp = P.levelProgress(st.xp.total);
    const pace = sumRange(0, 7).net / 7;
    const eta = pace > 0 ? Math.ceil((lp.need - lp.into) / pace) : null;
    const C0 = 2 * Math.PI * 40;
    const totalG = SPH.reduce((a, s) => a + cur.g[s], 0);

    // Самый продуктивный день недели за 8 недель
    const byDow = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 56; i++) { const k = S.addDays(S.today(), -i); byDow[(parse(k).getDay() + 6) % 7] += H(k).gain - H(k).loss; }
    const dowNames = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
    const bestDow = byDow.some((v) => v > 0) ? dowNames[byDow.indexOf(Math.max(...byDow))] : null;
    let bestDay = null;
    for (const [k, h] of Object.entries(st.history)) if (!bestDay || h.gain - h.loss > bestDay.net) bestDay = { k, net: h.gain - h.loss };

    return `
      <h1>Прогресс</h1>
      <div class="card level-hero">
        <div class="ring big"><svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--surface-2)" stroke-width="8"/>
          <circle cx="48" cy="48" r="40" fill="none" stroke="var(--aura)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C0}" stroke-dashoffset="${C0 * (1 - lp.pct)}"/></svg>
          <div class="lvl num">${lp.level}</div></div>
        <div class="stack" style="gap:4px;min-width:0">
          <span class="label">Уровень ${lp.level}</span><h2>${esc(P.rankTitle(lp.level))}</h2>
          <span class="num">${fmt(lp.into)} / ${fmt(lp.need)} до ур. ${lp.level + 1}</span>
          <span class="muted" style="font-size:.85rem">${eta ? `При темпе ${fmt(pace)} в день — примерно через ${eta} ${plural(eta, 'день', 'дня', 'дней')}` : 'Выполни задания, чтобы увидеть прогноз'}</span>
        </div>
      </div>

      <div class="tabs" role="tablist">${[[7, 'Неделя'], [30, 'Месяц'], [90, '3 месяца']].map(([p, l]) => `<button class="tab${period === p ? ' on' : ''}" data-act="stat-period" data-id="${p}" role="tab" aria-selected="${period === p}">${l}</button>`).join('')}</div>

      <div class="stats">
        <div class="stat"><span class="muted">Аура за период</span><b class="num ${cur.net >= 0 ? '' : 'minus'}">${signed(cur.net)}</b>${delta(cur.net, prev.net)}</div>
        <div class="stat"><span class="muted">Выполнено заданий</span><b class="num">${cur.done}</b>${delta(cur.done, prev.done)}</div>
        <div class="stat"><span class="muted">Выполняемость</span><b class="num">${rate === null ? '—' : rate + '%'}</b><span class="delta">${cur.missed} ${plural(cur.missed, 'пропуск', 'пропуска', 'пропусков')}</span></div>
        <div class="stat"><span class="muted">Серия</span><b class="num">${S.effectiveStreak()} 🔥</b><span class="delta">рекорд ${st.streak.best}</span></div>
      </div>

      <section class="card stack">
        <div class="section-head"><h2>Аура ${period > 30 ? 'по неделям' : 'по дням'}</h2><span class="muted">коснись столбика</span></div>
        <div class="legend">${SERIES.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${s.label}</span>`).join('')}<span><i class="sw" style="background:var(--danger)"></i>Потери</span></div>
        ${barChart(bs, sel)}
        ${sel !== null ? dayDetail(bs[sel]) : ''}
      </section>

      <section class="card stack">
        <div class="section-head"><h2>Рост ауры</h2><span class="muted">пунктир — уровни</span></div>
        ${lineChart(bs, sel)}
      </section>

      <section class="card stack">
        <h2>Сферы</h2>
        ${SPH.map((s) => {
          const slp = P.levelProgress(st.xp[s]);
          const share = totalG ? Math.round(cur.g[s] / totalG * 100) : 0;
          return `<div class="sphere-row ${sc(s)}">
            <div class="row"><b style="color:var(--c)">${sphereLabel(s)}</b><span class="chip num">ур. ${slp.level}</span><span class="spacer"></span>
              <span class="num">+${fmt(cur.g[s])}</span><span class="muted num" style="min-width:38px;text-align:right">${share}%</span></div>
            <div class="bar"><i style="width:${Math.round(slp.pct * 100)}%"></i></div>
            <span class="muted num" style="font-size:.78rem">${fmt(slp.into)} / ${fmt(slp.need)} до ур. ${slp.level + 1} · всего ${fmt(st.xp[s])}</span>
          </div>`;
        }).join('')}
        ${totalG ? `<p class="muted" style="font-size:.85rem">${(() => { const w = SPH.slice().sort((a, b) => cur.g[a] - cur.g[b])[0]; return `Меньше всего внимания сейчас получает ${sphereLabel(w).toLowerCase()}.`; })()}</p>` : ''}
      </section>

      <section class="card stack">
        <div class="section-head"><h2>Календарь активности</h2><span class="muted">12 недель</span></div>
        <div style="overflow-x:auto">${heatmap()}</div>
        <div class="legend"><span>Меньше</span>${[0, 1, 2, 3, 4].map((l) => `<i class="sw hm l${l}"></i>`).join('')}<span>Больше</span></div>
        ${ui.heatDay ? (() => { const h = H(ui.heatDay); return `<div class="detail"><b>${esc(short(ui.heatDay))}</b>: ${h.done} ${plural(h.done, 'задание', 'задания', 'заданий')}, аура <b class="num ${h.gain - h.loss >= 0 ? 'plus' : 'minus'}">${signed(h.gain - h.loss)}</b>${S.state.plans[ui.heatDay] ? ' · была планёрка' : ''}</div>`; })() : ''}
      </section>

      <section class="stats">
        <div class="stat"><span class="muted">Лучший день</span><b class="num">${bestDay && bestDay.net > 0 ? signed(bestDay.net) : '—'}</b><span class="delta">${bestDay && bestDay.net > 0 ? esc(short(bestDay.k)) : ''}</span></div>
        <div class="stat"><span class="muted">Сильный день недели</span><b style="font-size:1rem">${bestDow || '—'}</b></div>
        <div class="stat"><span class="muted">Планёрок</span><b class="num">${st.stats.plans || 0}</b></div>
        <div class="stat"><span class="muted">Всего заданий</span><b class="num">${st.stats.tasksDone}</b></div>
      </section>

      <details class="card"><summary>Таблица по дням</summary>
        <div style="overflow-x:auto"><table class="rules num"><thead><tr><td class="muted">${period > 30 ? 'Неделя' : 'День'}</td><td class="muted">Задания</td><td class="muted">Аура</td></tr></thead>
        <tbody>${bs.slice().reverse().map((b) => `<tr><td>${esc(b.title)}</td><td>${b.done}${b.missed ? ` <span class="minus">(−${b.missed})</span>` : ''}</td><td class="${b.net >= 0 ? 'plus' : 'minus'}">${signed(b.net)}</td></tr>`).join('')}</tbody></table></div>
      </details>`;
  };

  Object.assign(HQ.viewActions, {
    'stat-period'(d) { ui.statPeriod = Number(d.id); ui.statSel = null; HQ.ui.render(); },
    'stat-pick'(d) { const i = Number(d.i); ui.statSel = ui.statSel === i ? null : i; HQ.ui.render(); },
    'stat-heat'(d) { ui.heatDay = ui.heatDay === d.id ? null : d.id; HQ.ui.render(); },
  });
})(typeof self !== 'undefined' ? self : this);
