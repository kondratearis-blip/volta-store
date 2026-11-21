// Мини-клиент Supabase на fetch: таблицы (PostgREST), хранилище и вход по паролю.
// Без SDK, чтобы не тянуть 100+ КБ. Сессия администратора — в localStorage.

const SESSION_KEY = 'kokoro.session';

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* приватный режим — сессия живёт до перезагрузки */ }
}

// Ограничение времени запроса: AbortSignal.timeout есть не везде (Safari на iOS 15 и старше — нет)
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export class SupabaseError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createClient(url, key) {
  let session = readSession();
  const isJwtKey = key.startsWith('eyJ');

  const expiresSoon = (s) => !!(s?.expires_at && s.expires_at * 1000 < Date.now() + 60_000);

  // Ключ обновления входа одноразовый, а вход один на все вкладки браузера (localStorage). Вкладка, которая держит в памяти
  // уже обменянный соседкой ключ и предъявляет его ещё раз, для Supabase — признак кражи: он сбрасывает вход на всех вкладках
  // (11.11.2026: менеджера «выкидывало» из панели, открытой в нескольких вкладках). Поэтому перед обменом берём свежий вход,
  // который соседняя вкладка уже сохранила, — того же пользователя и не старее нашего
  function adoptStored() {
    const stored = readSession();
    if (!session || !stored?.refresh_token || stored.refresh_token === session.refresh_token) return false;
    if ((stored.user?.id || null) !== (session.user?.id || null)) return false;
    if ((stored.expires_at || 0) < (session.expires_at || 0)) return false;
    session = stored;
    return true;
  }

  async function refreshSession() {
    if (!session) return; // пока ждали очередь, вышли из панели
    if (adoptStored() && !expiresSoon(session)) return; // соседняя вкладка уже обновила вход
    try {
      const data = await request('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, { auth: false, timeout: 15_000 });
      session = data; writeSession(session);
    } catch (err) {
      // Нет связи — сессию не стираем, запрос просто не пройдёт
      if (err instanceof TypeError) throw err;
      // Отказ из-за того, что соседняя вкладка обменяла этот же ключ на мгновение раньше, — её вход живой, берём его
      if (adoptStored() && !expiresSoon(session)) return;
      // Сервер отказал — вход сброшен: не продолжаем молча как гость (иначе панель покажет «Заказов нет» вместо экрана входа)
      session = null; writeSession(null);
      throw new SupabaseError('Вход сброшен — войдите снова', 401);
    }
  }

  let refreshing = null; // один обмен на вкладку: параллельные запросы ждут его, а не предъявляют ключ каждый сам
  async function freshToken() {
    if (!session) return null;
    adoptStored();
    if (expiresSoon(session)) {
      // Между вкладками — по очереди (Web Locks; где их нет — как раньше, по одной вкладке)
      refreshing ||= (navigator.locks?.request ? navigator.locks.request('kokoro.session.refresh', refreshSession) : refreshSession())
        .finally(() => { refreshing = null; });
      await refreshing;
      if (!session) throw new SupabaseError('Вход сброшен — войдите снова', 401);
    }
    return session.access_token;
  }

  // timeout (мс) — не ждать «зависшую» мобильную связь минутами: обрыв считается «нет связи» (TypeError, как у fetch)
  async function request(method, path, body, { auth = true, headers = {}, raw = false, withHeaders = false, timeout = 0 } = {}) {
    const finalHeaders = { apikey: key, ...headers };
    const token = auth ? await freshToken() : null;
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
    else if (isJwtKey && !finalHeaders.Authorization) finalHeaders.Authorization = `Bearer ${key}`;
    let payload = body;
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
      finalHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url + path, { method, headers: finalHeaders, body: payload, ...(timeout ? { signal: timeoutSignal(timeout) } : {}) });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new TypeError('Нет связи: сервер не ответил вовремя');
      throw err;
    }
    if (raw) {
      if (!response.ok) throw new SupabaseError(`Ошибка ${response.status}`, response.status);
      return response;
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      // Сессию этого входа удалили на сервере (supabase/reset-password.sql, «Выйти везде»), а пропуск ещё не истёк —
      // это сброшенный вход, а не «проверьте интернет»: стираем его здесь, панель покажет форму пароля
      if (token && data?.error_code === 'session_not_found') {
        session = null; writeSession(null);
        throw new SupabaseError('Вход сброшен — войдите снова', 401);
      }
      const message = data?.message || data?.msg || data?.error_description || data?.error || `Ошибка ${response.status}`;
      throw new SupabaseError(message, response.status);
    }
    return withHeaders ? { data, headers: response.headers } : data;
  }

  const enc = encodeURIComponent;

  return {
    get session() { return session; },

    /** GET /rest/v1/table?query — query: строка PostgREST (select=*&order=...) */
    select(table, query = 'select=*') {
      return request('GET', `/rest/v1/${table}?${query}`);
    },
    /**
     * Все строки, сколько бы их ни было. Supabase отдаёт за запрос не больше Max rows
     * (по умолчанию 1000), поэтому листаем страницами по ключу: key > последнего полученного.
     * В отличие от offset, страницы не съезжают, если между запросами строки добавили или удалили.
     * query — фильтры без order и limit; key обязан быть в select и уникальным.
     * Строки приходят по возрастанию key — нужный порядок наводит вызывающий.
     */
    async selectAll(table, query = 'select=*', { key = 'id', pageSize = 1000 } = {}) {
      const rows = [];
      let total = Infinity;
      let last = null;
      for (;;) {
        const after = last === null ? '' : `&${key}=gt.${enc(last)}`;
        const { data: page, headers } = await request('GET', `/rest/v1/${table}?${query}${after}&order=${key}.asc&limit=${pageSize}`, undefined, {
          // Общее число строк спрашиваем один раз: обычно хватает одного запроса
          headers: last === null ? { Prefer: 'count=exact' } : {},
          withHeaders: true,
        });
        if (last === null) {
          const match = /\/(\d+)$/.exec(headers.get('content-range') || '');
          if (match) total = Number(match[1]);
        }
        if (!Array.isArray(page) || page.length === 0) break;
        rows.push(...page);
        // Страница могла быть урезана сервером (Max rows меньше pageSize) — тогда идём дальше
        if (rows.length >= total) break;
        const next = page[page.length - 1][key];
        if (next === undefined || next === null) throw new Error(`selectAll: поле ${key} должно быть в select`);
        if (next === last) throw new Error('selectAll: сервер вернул ту же страницу повторно');
        last = next;
      }
      return rows;
    },
    insert(table, rows, { returning = true } = {}) {
      return request('POST', `/rest/v1/${table}`, rows, { headers: { Prefer: returning ? 'return=representation' : 'return=minimal' } });
    },
    upsert(table, rows, onConflict) {
      return request('POST', `/rest/v1/${table}?on_conflict=${enc(onConflict)}`, rows, {
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });
    },
    /** match — строка фильтра PostgREST, например id=eq.123 */
    update(table, match, patch) {
      return request('PATCH', `/rest/v1/${table}?${match}`, patch, { headers: { Prefer: 'return=representation' } });
    },
    remove(table, match) {
      return request('DELETE', `/rest/v1/${table}?${match}`);
    },
    /** options.auth = false — без входа менеджера, даже если он вошёл на этом устройстве (страница курьера) */
    rpc(fn, args = {}, options = {}) {
      return request('POST', `/rest/v1/rpc/${fn}`, args, options);
    },

    storage: {
      upload(bucket, path, blob) {
        return request('POST', `/storage/v1/object/${bucket}/${path}`, blob, {
          headers: { 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': '31536000' },
        });
      },
      publicUrl(bucket, path) {
        return `${url}/storage/v1/object/public/${bucket}/${path}`;
      },
      async download(bucket, path) {
        // Путь пишет покупатель: «.» и «..» не пускаем (encodeURIComponent точки не кодирует, и fetch
        // свернул бы «../» в другой адрес), остальные сегменты кодируем
        const segments = path.split('/');
        if (segments.some((s) => s === '' || s === '.' || s === '..')) throw new SupabaseError('Недопустимый путь файла', 400);
        const safe = segments.map(encodeURIComponent).join('/');
        const response = await request('GET', `/storage/v1/object/authenticated/${bucket}/${safe}`, undefined, { raw: true });
        return response.blob();
      },
      copy(fromBucket, fromPath, toBucket, toPath) {
        return request('POST', '/storage/v1/object/copy', {
          bucketId: fromBucket, sourceKey: fromPath, destinationBucket: toBucket, destinationKey: toPath,
        });
      },
      remove(bucket, paths) {
        return request('DELETE', `/storage/v1/object/${bucket}`, { prefixes: paths });
      },
    },

    auth: {
      async signIn(email, password) {
        session = await request('POST', '/auth/v1/token?grant_type=password', { email, password }, { auth: false });
        writeSession(session);
        return session;
      },
      /** scope: 'global' (по умолчанию) — выйти на всех устройствах этого аккаунта, 'local' — только здесь */
      async signOut(scope = 'global') {
        // На этом устройстве вход стираем сразу, что бы ни было со связью; потом отзываем его на сервере
        // (истёкший пропуск сначала обновляем — с ним сервер выход не примет). «Зависшую» связь ждём не дольше 10 с на шаг
        const current = session;
        session = null; writeSession(null);
        if (!current) return;
        try {
          let token = current.access_token;
          if (current.expires_at && current.expires_at * 1000 < Date.now() + 60_000) {
            token = (await request('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: current.refresh_token }, { auth: false, timeout: 10_000 })).access_token;
          }
          await request('POST', `/auth/v1/logout?scope=${scope}`, {}, { auth: false, headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 });
        } catch { /* нет связи или вход уже сброшен на сервере */ }
      },
      user() { return session?.user || null; },
      /** Уровень входа: 'aal1' — только пароль, 'aal2' — пароль и код из приложения */
      aal() {
        try { return JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch { return null; }
      },
      /** Сменить пароль (при включённом коде из приложения нужен вход с кодом); остальные устройства выходят */
      async updatePassword(password) {
        const user = await request('PUT', '/auth/v1/user', { password });
        if (session) { session.user = user; writeSession(session); }
        return user;
      },
      /** Двухфакторный вход: код из приложения-аутентификатора (TOTP) */
      mfa: {
        async factors() {
          const user = await request('GET', '/auth/v1/user');
          if (session) { session.user = user; writeSession(session); }
          return (user.factors || []).filter((f) => f.factor_type === 'totp');
        },
        /** → { id, totp: { qr_code (data:-ссылка на картинку), secret, uri } } */
        async enroll(friendlyName) {
          const factor = await request('POST', '/auth/v1/factors', { factor_type: 'totp', friendly_name: friendlyName, issuer: 'KOKORO' });
          // Сервер отдаёт QR как разметку <svg>, а не ссылку на картинку
          if (factor?.totp?.qr_code && !factor.totp.qr_code.startsWith('data:')) {
            factor.totp.qr_code = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(factor.totp.qr_code)}`;
          }
          return factor;
        },
        /** Проверяет код и поднимает сессию до aal2 */
        async verify(factorId, code) {
          const challenge = await request('POST', `/auth/v1/factors/${factorId}/challenge`, {});
          session = await request('POST', `/auth/v1/factors/${factorId}/verify`, { challenge_id: challenge.id, code });
          writeSession(session);
          return session;
        },
        unenroll(factorId) { return request('DELETE', `/auth/v1/factors/${factorId}`); },
      },
    },
  };
}
