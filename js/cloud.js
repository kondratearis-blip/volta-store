/*
 * Облачное сохранение. Когда игра открыта внутри Claude (страница claude.ai/artifact),
 * память браузера там ненадёжна, поэтому прогресс и черновик интервью дублируются
 * в личное хранилище игрока (виден только ему). На своём сайте и в Android-приложении
 * этого API нет — там работает обычная память устройства.
 */
(function (root) {
  const HQ = root.HQ;
  const S = HQ.store;
  const MAX = 240 * 1024; // лимит документа 256 КБ, оставляем запас

  let ref = null, ready = false, writing = false, again = false, timer = null, draft = null;

  const cloud = {
    status: 'local', // local | connecting | synced | readonly
    saveDraft(iv) { draft = iv; if (ready) queue(); },
  };
  HQ.cloud = cloud;

  // Копия для облака: укороченный журнал, а при нехватке места — и история.
  function payload() {
    const copy = JSON.parse(JSON.stringify(S.state));
    copy.log = (copy.log || []).slice(0, 150);
    let json = JSON.stringify(copy);
    if (json.length > MAX) {
      const keys = Object.keys(copy.history || {}).sort();
      while (json.length > MAX && keys.length > 30) { delete copy.history[keys.shift()]; json = JSON.stringify(copy); }
    }
    return { state: json, draft: draft ? JSON.stringify(draft) : null, savedAt: S.state.savedAt || Date.now() };
  }

  function queue() {
    clearTimeout(timer);
    timer = setTimeout(write, 1200);
  }

  async function write() {
    timer = null;
    if (!ref || cloud.status === 'readonly') return;
    if (writing) { again = true; return; }
    writing = true;
    try {
      await ref.set(payload());
      cloud.status = 'synced';
    } catch (e) {
      if (e && e.code === 'unavailable') { again = true; await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500)); }
      else cloud.status = 'readonly'; // нет права записи или документ слишком большой — остаётся память устройства
    } finally {
      writing = false;
      if (again && cloud.status !== 'readonly') { again = false; queue(); }
    }
  }

  async function start() {
    const c = root.claude;
    if (!c || typeof c.use !== 'function') return;
    cloud.status = 'connecting';
    try {
      // Не держим игрока на экране загрузки дольше 5 секунд.
      const timeout = new Promise((r) => setTimeout(() => r([null, null]), 5000));
      const [db, user] = await Promise.race([Promise.all([c.use('db'), c.use('user')]), timeout]);
      const id = user ? await user.id() : null;
      if (!db || !id) { cloud.status = 'local'; HQ.ui.render(); return; }
      ref = db.doc(`data/users/${id}/hunterquest`);
      const snap = await ref.get();
      const local = S.state;
      let changed = false;
      if (snap.exists) {
        const d = snap.data() || {};
        const remote = d.state ? JSON.parse(d.state) : null;
        if (remote && remote.profile && (!local.profile || (remote.savedAt || 0) > (local.savedAt || 0))) {
          S.replaceState(remote);
          S.rollover();
          changed = true;
        }
        const iv = HQ.ui.state.iv;
        if (!S.state.profile && d.draft) {
          const remoteDraft = JSON.parse(d.draft);
          if (remoteDraft && remoteDraft.answers && Object.keys(remoteDraft.answers).length > Object.keys(iv.answers || {}).length) {
            HQ.ui.state.iv = remoteDraft;
            draft = remoteDraft;
            changed = true;
          }
        }
      }
      ready = true;
      cloud.status = 'synced';
      if (!draft && !S.state.profile && Object.keys(HQ.ui.state.iv.answers || {}).length) draft = HQ.ui.state.iv;
      // В облаке нет того, что уже есть на устройстве — отправляем.
      if (!snap.exists || !changed) queue();
      HQ.ui.after();
    } catch (e) {
      cloud.status = 'local';
      HQ.ui.render();
    }
  }

  S.onSave(() => { if (ready) queue(); });
  // Уходя со страницы, не ждём паузы.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); write(); } });

  HQ.views.cloudStatus = function () {
    const text = {
      synced: 'Прогресс сохраняется в твоём аккаунте Claude и не пропадёт при перезаходе.',
      connecting: 'Подключаю облачное сохранение…',
      readonly: 'Облачное сохранение недоступно: прогресс хранится только на этом устройстве. Сделай резервную копию ниже.',
      local: 'Прогресс хранится на этом устройстве.',
    }[cloud.status];
    return `<p class="muted" style="font-size:.85rem">${text}</p>`;
  };

  cloud.start = start;
})(typeof self !== 'undefined' ? self : this);
