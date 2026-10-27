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

export class SupabaseError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function createClient(url, key) {
  let session = readSession();
  const isJwtKey = key.startsWith('eyJ');

  async function freshToken() {
    if (!session) return null;
    const expiresSoon = session.expires_at && session.expires_at * 1000 < Date.now() + 60_000;
    if (expiresSoon) {
      try {
        const data = await request('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, { auth: false });
        session = data; writeSession(session);
      } catch {
        session = null; writeSession(null);
        return null;
      }
    }
    return session.access_token;
  }

  async function request(method, path, body, { auth = true, headers = {}, raw = false, withHeaders = false } = {}) {
    const finalHeaders = { apikey: key, ...headers };
    const token = auth ? await freshToken() : null;
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
    else if (isJwtKey) finalHeaders.Authorization = `Bearer ${key}`;
    let payload = body;
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
      finalHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(url + path, { method, headers: finalHeaders, body: payload });
    if (raw) {
      if (!response.ok) throw new SupabaseError(`Ошибка ${response.status}`, response.status);
      return response;
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
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
    rpc(fn, args = {}) {
      return request('POST', `/rest/v1/rpc/${fn}`, args);
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
        const response = await request('GET', `/storage/v1/object/authenticated/${bucket}/${path}`, undefined, { raw: true });
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
      async signOut() {
        try { await request('POST', '/auth/v1/logout', {}); } catch { /* сессия могла истечь */ }
        session = null; writeSession(null);
      },
      user() { return session?.user || null; },
    },
  };
}
