// Окно чата по заказу (specs/018) — одно на покупателя, курьера и панель. Окно — <dialog> (фокус, Esc и затемнение даёт
// браузер). Только текст: сообщения выводятся через textContent, ссылки и разметка не работают. Пока окно открыто и вкладка
// видна — новые сообщения раз в 5 секунд. Метки «есть новое» считаются по сводке (последний id и кто писал) и прочитанному
// на этом устройстве (localStorage).
const POLL_MS = 5_000;
const READ_KEY = 'kokoro.chat.read';
const MAX = 500;

const readMarks = () => { try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}') || {}; } catch { return {}; } };
/** Отметить прочитанным: key — «заказ на этом устройстве» (например, `client:<token>`), lastId — последнее увиденное */
export function markRead(key, lastId) {
  if (!key || !Number(lastId)) return;
  const marks = readMarks();
  if ((marks[key] || 0) >= Number(lastId)) return;
  marks[key] = Number(lastId);
  const keys = Object.keys(marks);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete marks[k]); // старые ключи не копим
  try { localStorage.setItem(READ_KEY, JSON.stringify(marks)); } catch { /* приватный режим */ }
}
/** Есть ли непрочитанное: последнее сообщение не моё и новее прочитанного. summary — { last_id, last_author } */
export function hasUnread(key, summary, mine) {
  if (!summary || !summary.last_id || summary.last_author === mine) return false;
  return Number(summary.last_id) > (readMarks()[key] || 0);
}

/** Короткий сигнал о новом сообщении (тише, чем «Новый заказ»). Без звука, если браузер не дал */
export function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = chime.ctx || (chime.ctx = new Ctx());
    const t = ctx.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.2);
    });
  } catch { /* без звука */ }
}

const clock = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' });

/**
 * Открыть чат. Параметры:
 *  title — заголовок («Чат по заказу № 12»);
 *  mine — кто я: 'client' | 'courier' | 'manager' (свои сообщения — справа);
 *  labels — подписи авторов { client, courier, manager } (для панели у курьера — его имя из message.courier);
 *  load(after) → { open, can_write, messages: [{ id, author, body, at, courier?, label?, own? }] } или null (заказ недоступен);
 *  closedNote — текст вместо поля ввода, когда писать нельзя;
 *  send(body) → { id, at }; ошибка — исключение с понятным текстом;
 *  readKey — ключ прочитанного на этом устройстве; t — перевод строк (у покупателя — tx из i18n.js).
 * Возвращает { close }. Повторный вызов закрывает прежнее окно.
 */
export function openChat({ title, mine, labels = {}, load, send, readKey, closedNote, t = (s) => s, onClose }) {
  openChat.current?.close();
  const dlg = document.createElement('dialog');
  dlg.className = 'chat';
  dlg.setAttribute('aria-label', title);
  dlg.innerHTML = `
    <div class="chat__head">
      <h2 class="chat__title"></h2>
      <button class="chat__close" type="button" data-chat-close></button>
    </div>
    <ol class="chat__list" aria-live="polite" aria-relevant="additions"></ol>
    <p class="chat__note" data-chat-note hidden></p>
    <form class="chat__form" data-chat-form novalidate>
      <label class="visually-hidden" for="chat-body"></label>
      <textarea id="chat-body" name="body" rows="2" maxlength="${MAX}"></textarea>
      <div class="chat__row">
        <span class="chat__count" data-chat-count>0 / ${MAX}</span>
        <button class="btn btn--tray btn--small chat__send" type="submit"></button>
      </div>
      <p class="chat__error" data-chat-error role="alert"></p>
    </form>`;
  const $ = (s) => dlg.querySelector(s);
  $('.chat__title').textContent = title;
  $('[data-chat-close]').textContent = '×';
  $('[data-chat-close]').setAttribute('aria-label', t('Закрыть'));
  $('label[for="chat-body"]').textContent = t('Напишите сообщение');
  $('textarea').placeholder = t('Напишите сообщение');
  $('.chat__send').textContent = t('Отправить');
  document.body.append(dlg);

  const list = $('.chat__list');
  const form = $('[data-chat-form]');
  const area = $('textarea');
  const count = $('[data-chat-count]');
  const note = $('[data-chat-note]');
  const error = $('[data-chat-error]');
  let after = 0;
  let timer = null;
  let busy = false;
  let closed = false;

  // own — база сама говорит, моё ли сообщение (чат курьера с менеджерами, specs/021: в панели «Вы» — только свои, а не всей
  // стороны); label — подпись автора от базы («Менеджер Кулиева», «Владелец»)
  const isMine = (m) => (typeof m.own === 'boolean' ? m.own : m.author === mine);
  const nameOf = (m) => (isMine(m) ? t('Вы')
    : m.author === 'courier' && labels.courierName && m.courier ? `${labels.courier || t('Курьер')} ${m.courier}`
      : m.label || labels[m.author] || m.author);
  const render = (messages) => {
    const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    for (const m of messages) {
      if (list.querySelector(`[data-id="${Number(m.id)}"]`)) continue;
      const li = document.createElement('li');
      li.className = `chat__msg chat__msg--${isMine(m) ? 'mine' : m.author}`;
      li.dataset.id = String(Number(m.id));
      const who = document.createElement('span');
      who.className = 'chat__who';
      who.textContent = `${nameOf(m)} · ${clock.format(new Date(m.at))}`;
      const body = document.createElement('p');
      body.className = 'chat__body';
      body.textContent = m.body;
      li.append(who, body);
      list.append(li);
      after = Math.max(after, Number(m.id));
    }
    if (stick || messages.some(isMine)) list.scrollTop = list.scrollHeight;
    if (readKey && after) markRead(readKey, after);
  };
  const setOpen = (data) => {
    const writable = !!data?.can_write;
    form.hidden = !writable;
    note.hidden = writable;
    note.textContent = closedNote || t('Чат по этому заказу закрыт');
  };
  let again = false; // попросили обновить, пока шёл прежний запрос (своё сообщение после отправки) — повторим сразу после него
  const refresh = async () => {
    if (closed) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const data = await load(after);
      setOpen(data);
      if (data?.messages?.length) render(data.messages);
    } catch (err) {
      // Связь пропала — молча, следующий опрос попробует снова; первое открытие — скажем
      if (!after) error.textContent = err instanceof TypeError ? t('Нет связи. Проверьте интернет и попробуйте ещё раз.') : err.message;
    } finally {
      busy = false;
      if (again && !closed) { again = false; refresh(); }
    }
  };

  area.addEventListener('input', () => { count.textContent = `${area.value.length} / ${MAX}`; error.textContent = ''; });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = area.value.trim();
    if (!body) { error.textContent = t('Напишите сообщение'); area.focus(); return; }
    const button = form.querySelector('.chat__send');
    button.disabled = true;
    try {
      await send(body);
      area.value = '';
      count.textContent = `0 / ${MAX}`;
      await refresh();
    } catch (err) {
      error.textContent = err instanceof TypeError ? t('Нет связи. Проверьте интернет и попробуйте ещё раз.') : t(err.message);
    } finally { button.disabled = false; area.focus(); }
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    if (dlg.open) dlg.close();
    dlg.remove();
    if (openChat.current?.dlg === dlg) openChat.current = null;
    onClose?.(after);
  };
  const onVisible = () => { if (!document.hidden) refresh(); };
  $('[data-chat-close]').addEventListener('click', close);
  dlg.addEventListener('close', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // нажатие на затемнение
  document.addEventListener('visibilitychange', onVisible);

  dlg.showModal();
  refresh();
  timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  openChat.current = { dlg, close };
  return { close };
}
